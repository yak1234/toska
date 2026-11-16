// Repaint from asset in a chat (openspec repaint-from-asset 3.x; the module is tested in repaint-from-asset.test.ts): the tool
// is offered when the chat has a picture; a request that names an attached picture makes the move repaint from it, and
// make_asset is refused in that move; the area card answered without an area is remembered. A local model server and a
// fake bridge, as paint-only-here-studio.test.mjs.
import { recordingTracing } from './fake-langfuse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { StudioRuntime } from '../src/studio.mjs';
import { encodePlane, encodeRgba } from '../src/shapes/png.ts';
import { pngSize } from '../src/png-rgba.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const call = (name, args) => ({ tool_calls: [{ index: 0, id: 'call-' + Math.random().toString(36).slice(2), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

async function harness(respond) {
  const output = await mkdtemp(join(tmpdir(), 'paint-only-studio-'));
  const requests = [], calls = [], events = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); requests.push(request);
    const delta = await respond(request, requests.length);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const choice of [{ delta: { role: 'assistant', ...delta }, finish_reason: null }, { delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }])
      res.write('data: ' + JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'vision-test', choices: [{ index: 0, ...choice }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const models = await ModelRuntime.create({ authPath: join(output, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  models.registerProvider('local-test', { api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'vision-test', name: 'Test', reasoning: false, input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }] });
  await models.setRuntimeApiKey('local-test', 'test-only');
  let observation;
  const bridge = { async call(operation, params) {
    calls.push({ operation, params });
    if (operation === 'context') return { document_id: 'doc', active_document_id: 'doc', name: 'Untitled', filename: '', width: 768, height: 1024, modified: true, revision: 'revision-0' };
    if (['begin', 'peek'].includes(operation)) {
      const path = join(params.output_dir, 'view.png'); await writeFile(path, png);
      observation = { status: 'ok', document_id: 'doc', name: 'Untitled', filename: '', modified: true, width: 768, height: 1024, image_path: path, layers: [], revision: 'revision-0', content_id: 'content-0', captured_at: new Date().toISOString(),
        ...(operation === 'begin' ? { checkpoint: params.painting_path ?? join(params.output_dir, 'painting.kra') } : {}) };
      if (operation === 'begin') await writeFile(observation.checkpoint, 'test painting');
    }
    return operation === 'end' ? { status: 'ok' } : observation;
  } };
  const capabilities = { async initialize() {}, status() { return { status: 'verified', route_verified: true, images_supported: true, tools_supported: true }; }, async verify() { return { route_verified: true, cached: true }; }, async invalidate() {} };
  const runtime = new StudioRuntime({defaultPlanner:null,sharpenModel:{download:async()=>{throw new Error('No model downloads in tests.');},service:{upscale:async()=>{throw new Error('No sharpening in tests.');}}}, root: output, config: { output }, models, bridge, capabilities, tracing: recordingTracing(), emit: e => events.push(e) });
  return { runtime, requests, calls, events, output,
    async close() { if (runtime.busy) runtime.stop(); await runtime.writeQueue; await runtime.end().catch(() => {}); runtime.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(output, { recursive: true, force: true }); } };
}
async function agentChat(respond) {
  const painted = [];
  const h = await harness((req, n) => {
    if (!req.tools.some(t => t.function.name === 'paint_batch')) return { content: 'Hello.' };
    painted.push(req);
    return respond(req, painted.length);
  });
  const goal = join(h.output, 'final_goal.png'); await writeFile(goal, png);
  await h.runtime.start({ provider: 'local-test', model: 'vision-test', chat_mode: 'ask', prompt: 'Hello', mode: 'copy', references: [{ path: goal, purpose: 'general' }] });
  await h.runtime.setExecutionSettings({ move_size: 'quick' }); await h.runtime.setMode('agent');
  return { h, painted };
}

const offered = req => req.tools.map(t => t.function.name);
const toolTexts = req => req.messages.filter(m => m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');

test('repaint_from_asset is offered in an Agent move of a chat with a picture', { timeout: 30000 }, async () => {
  const { h, painted } = await agentChat(() => ({ content: 'Done.' }));
  try {
    await h.runtime.prompt('Paint the sky');
    assert.ok(offered(painted[0]).includes('repaint_from_asset'));
    assert.doesNotMatch(JSON.stringify(painted[0].messages), /THE ARTIST NAMED AN ATTACHED IMAGE/, 'a blank canvas: the picture is the goal to lay, not an asset');
  } finally { await h.close(); }
});

test('a request that names the attached picture on a painted canvas repaints from it, and make_asset is refused in that move', { timeout: 30000 }, async () => {
  const { h, painted } = await agentChat((req, n) => n === 1 ? call('make_asset', { name: 'Buildings', mode: 'generate', prompt: 'Historic buildings' }) : { content: 'I will repaint from your image.' });
  try {
    h.runtime.repaintable = () => true;                                   // an underpainting is on the canvas
    await h.runtime.prompt('lets now paint the buildings with this reference');
    const sent = JSON.stringify(painted[0].messages);
    assert.match(sent, /THE ARTIST NAMED AN ATTACHED IMAGE for this: \\"final_goal\.png\\"/);
    assert.match(sent, /repaint_from_asset/);
    assert.doesNotMatch(sent, /call ask_for_selection for that part/);
    assert.equal(h.runtime.currentMove?.repaint?.name ?? h.runtime.goal.moves.at(-1).repaint.name, 'final_goal.png');
    assert.match(toolTexts(painted[1]), /repaint the part from it with repaint_from_asset \(reference_id reference-/);
  } finally { await h.close(); }
});

test('a request that asks for an AI image may still make one', { timeout: 30000 }, async () => {
  const { h, painted } = await agentChat((req, n) => n === 1 ? call('make_asset', { name: 'Buildings', mode: 'generate', prompt: 'Historic buildings' }) : { content: 'Done.' });
  try {
    h.runtime.repaintable = () => true;
    await h.runtime.prompt('generate an AI image of the buildings from this reference');
    assert.doesNotMatch(toolTexts(painted[1]), /repaint the part from it with repaint_from_asset/);
  } finally { await h.close(); }
});

test('the area card answered with Paint everywhere is remembered for repaint_from_asset, and another answer forgets it', { timeout: 30000 }, async () => {
  const { h } = await agentChat((req, n) => n === 1 ? call('ask_for_selection', { part: 'the tower' }) : { content: 'Waiting.' });
  try {
    await h.runtime.prompt('Paint the tower');
    assert.equal(h.runtime.goal.question?.select_area?.part, 'the tower');
    await h.runtime.prompt('Paint everywhere');
    assert.deepEqual(h.runtime.goal.area_passed, { part: 'the tower' });
  } finally { await h.close(); }
});
