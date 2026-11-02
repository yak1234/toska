// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// A baseline JPEG encoder (ITU T.81: sequential DCT, Huffman, 4:2:0 chroma), so the companion's scripts can send a picture to
// an image model at a fraction of a PNG's size without a native image library (benchmark-judge.ts: pilot 2's 40 MB PNGs were
// refused with HTTP 413). The quantisation and Huffman tables are the example tables of T.81 Annex K, the quantisation scaled
// by quality as the IJG library does. Input: RGBA, not premultiplied; alpha is composited over white.
// Mechanism only: no .mjs imports.

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array<number>(32).fill(99)];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
// T.81 Table K.5 (luminance AC); used for chroma too (components may share tables).
export const AC_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];

/** Huffman codes for (bits, values): code and length per symbol. */
function huffman(bits: number[], values: number[]): { code: Int32Array; length: Int32Array } {
  const code = new Int32Array(256), length = new Int32Array(256);
  let next = 0, k = 0;
  for (let size = 1; size <= 16; size++) {
    for (let i = 0; i < bits[size - 1]!; i++) { code[values[k]!] = next++; length[values[k]!] = size; k++; }
    next <<= 1;
  }
  return { code, length };
}
const DC = huffman(DC_BITS, DC_VALUES), AC = huffman(AC_BITS, AC_VALUES);

function quantTable(base: number[], quality: number): number[] {
  const q = Math.min(100, Math.max(1, Math.round(quality))), scale = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map(v => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

// cos((2x + 1) u pi / 16) * c(u) / 2, for the separable 8x8 forward DCT.
const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1) / 2;

class Bits {
  private chunks: Buffer[] = [];
  private buffer = Buffer.alloc(65536);
  private at = 0;
  private word = 0;
  private count = 0;
  byte(value: number) { if (this.at === this.buffer.length) { this.chunks.push(this.buffer); this.buffer = Buffer.alloc(65536); this.at = 0; } this.buffer[this.at++] = value; }
  bytes(values: number[]) { for (const v of values) this.byte(v); }
  write(code: number, length: number) {
    for (let i = length - 1; i >= 0; i--) {
      this.word = (this.word << 1) | ((code >> i) & 1);
      if (++this.count === 8) { this.byte(this.word); if (this.word === 0xff) this.byte(0); this.word = 0; this.count = 0; }
    }
  }
  flush() { if (this.count) this.write((1 << (8 - this.count)) - 1, 8 - this.count); }
  done(): Buffer { return Buffer.concat([...this.chunks, this.buffer.subarray(0, this.at)]); }
}

/** RGBA pixels as a baseline JPEG at `quality` (1-100; about 90 keeps paint texture). */
export function encodeJpeg(image: { width: number; height: number; data: Uint8Array }, quality = 90): Buffer {
  const { width, height, data } = image;
  if (!(width > 0 && height > 0 && width < 65536 && height < 65536) || data.length < width * height * 4) throw new Error('encodeJpeg: invalid image');
  const tables = [quantTable(LUMA_Q, quality), quantTable(CHROMA_Q, quality)];
  const out = new Bits();
  const marker = (code: number, body: number[]) => { out.bytes([0xff, code, (body.length + 2) >> 8, (body.length + 2) & 255]); out.bytes(body); };
  out.bytes([0xff, 0xd8]);
  marker(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  marker(0xdb, [0, ...ZIGZAG.map(i => tables[0]![i]!), 1, ...ZIGZAG.map(i => tables[1]![i]!)]);
  marker(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  marker(0xc4, [0x00, ...DC_BITS, ...DC_VALUES, 0x10, ...AC_BITS, ...AC_VALUES]);
  marker(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]);

  // YCbCr planes, alpha over white, padded to whole 16 px MCUs by repeating the edge.
  const mw = Math.ceil(width / 16) * 16, mh = Math.ceil(height / 16) * 16;
  const Y = new Float32Array(mw * mh), Cb = new Float32Array((mw / 2) * (mh / 2)), Cr = new Float32Array((mw / 2) * (mh / 2));
  for (let y = 0; y < mh; y++) {
    const sy = Math.min(y, height - 1);
    for (let x = 0; x < mw; x++) {
      const i = (sy * width + Math.min(x, width - 1)) * 4, a = data[i + 3]! / 255, w = 255 * (1 - a);
      const r = data[i]! * a + w, g = data[i + 1]! * a + w, b = data[i + 2]! * a + w;
      Y[y * mw + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      const c = (y >> 1) * (mw / 2) + (x >> 1);
      Cb[c] += (-0.168736 * r - 0.331264 * g + 0.5 * b) / 4;
      Cr[c] += (0.5 * r - 0.418688 * g - 0.081312 * b) / 4;
    }
  }
  const block = new Float64Array(64), temp = new Float64Array(64), quantised = new Int32Array(64);
  const previous = [0, 0, 0];
  const encodeBlock = (plane: Float32Array, stride: number, bx: number, by: number, component: number, table: number[]) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[(by + y) * stride + bx + x]!;
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += block[y * 8 + x]! * COS[u * 8 + x]!; temp[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += temp[y * 8 + u]! * COS[v * 8 + y]!; block[v * 8 + u] = s; }
    for (let k = 0; k < 64; k++) quantised[k] = Math.round(block[ZIGZAG[k]!]! / table[ZIGZAG[k]!]!);
    const emit = (value: number) => { const magnitude = Math.abs(value), size = magnitude ? 32 - Math.clz32(magnitude) : 0; return { size, bits: value < 0 ? value + (1 << size) - 1 : value }; };
    const dc = emit(quantised[0]! - previous[component]!); previous[component] = quantised[0]!;
    out.write(DC.code[dc.size]!, DC.length[dc.size]!); if (dc.size) out.write(dc.bits, dc.size);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const value = quantised[k]!;
      if (!value) { run++; continue; }
      while (run > 15) { out.write(AC.code[0xf0]!, AC.length[0xf0]!); run -= 16; }
      const ac = emit(value), symbol = (run << 4) | ac.size;
      out.write(AC.code[symbol]!, AC.length[symbol]!); out.write(ac.bits, ac.size); run = 0;
    }
    if (run) out.write(AC.code[0]!, AC.length[0]!);
  };
  for (let my = 0; my < mh; my += 16) for (let mx = 0; mx < mw; mx += 16) {
    for (const [dx, dy] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) encodeBlock(Y, mw, mx + dx, my + dy, 0, tables[0]!);
    encodeBlock(Cb, mw / 2, mx / 2, my / 2, 1, tables[1]!);
    encodeBlock(Cr, mw / 2, mx / 2, my / 2, 2, tables[1]!);
  }
  out.flush();
  out.bytes([0xff, 0xd9]);
  return out.done();
}
