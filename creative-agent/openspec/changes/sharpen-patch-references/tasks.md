# Tasks: sharpen patch references

Tests first, seen failing. From `krita-creative-agent`: `npm run -s test:unit`, `npm run -s typecheck`.

- [x] 1. `src/reference-sharpen.ts`: `referenceSharpener(host, {spec, download, service})` with `refusal(reference)` (why it
      cannot be sharpened, or null) and `sharpen(reference, {signal, onProgress})`. Tests with a fake service:
      `tests/reference-sharpen.test.ts`.
- [x] 2. `reference-tool.mjs` `start()`: a stretch refusal sharpens through `runtime.sharpenReference`, scales the rects,
      reads the reference again and re-checks; the job's summary says so. Tests in `tests/reference.test.mjs`.
- [x] 3. `studio.mjs`: `sharpenReference` accessor on the runtime (the goal sharpener's host).
- [x] 4. Refusal text and tool descriptions say a reference stretched past 2x is sharpened first.
- [x] 5. Typecheck passes; the unit suite passes except tests of another change in progress (full-detail new ground, `tests/visual-checks.test.mjs` / `tests/blank-canvas.test.ts`), which this change does not touch. Run again once that lands.
- [ ] 6. Live in Toska on a copy of Istanbul: a 2.8x transfer sharpens and paints. Not done by the builder of 1-5.
