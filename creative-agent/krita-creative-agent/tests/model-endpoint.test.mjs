import test from 'node:test';
import assert from 'node:assert/strict';
import {describeModel, discoverEndpointModels, endpointProviderId, endpointUrl, withPrices} from '../src/model-endpoint.ts';

test('a listing entry gives only what its server reports, in each server\'s own field names', () => {
  assert.deepEqual(describeModel({id: 'plain'}), {id: 'plain', name: 'plain'});
  assert.deepEqual(describeModel({id: 'or/vision', name: 'Vision', context_length: 200000, top_provider: {max_completion_tokens: 32000},
    architecture: {input_modalities: ['text', 'image']}, supported_parameters: ['tools', 'reasoning']}),
  {id: 'or/vision', name: 'Vision', contextWindow: 200000, maxTokens: 32000, input: ['text', 'image'], reasoning: true});
  assert.deepEqual(describeModel({id: 'qwen-vl', type: 'vlm', max_context_length: 32768}), {id: 'qwen-vl', name: 'qwen-vl', contextWindow: 32768, input: ['text', 'image']});
  assert.deepEqual(describeModel({id: 'llama', type: 'llm'}), {id: 'llama', name: 'llama', input: ['text']});
  assert.deepEqual(describeModel({id: 'served', max_model_len: 65536}), {id: 'served', name: 'served', contextWindow: 65536});
  assert.deepEqual(describeModel({id: 'llava', capabilities: ['completion', 'vision']}).input, ['text', 'image']);
  assert.equal(describeModel({id: 'odd', context_length: 1000, max_output_tokens: 5000}).maxTokens, undefined, 'an output limit over the window is not believed');
  assert.equal(describeModel({id: 'zero', context_length: 0}).contextWindow, undefined);
  assert.equal(describeModel({id: 'nomic-embed', type: 'embeddings'}), null);
  assert.equal(describeModel({name: 'no id'}), null);
});

test('an endpoint is refused when it would send a key in the clear, and gets a provider id of its own', () => {
  assert.throws(() => endpointUrl('http://example.com/v1'), /HTTPS/);
  assert.throws(() => endpointUrl('https://user:secret@example.com/v1'), /credentials/);
  assert.throws(() => endpointUrl('not an address'), /full address/);
  assert.equal(endpointUrl('http://localhost:11434/v1').port, '11434');
  assert.equal(endpointProviderId('', endpointUrl('http://localhost:11434/v1')), 'custom-localhost-11434');
  assert.equal(endpointProviderId('  My LM Studio! ', endpointUrl('http://127.0.0.1:1234/v1')), 'custom-my-lm-studio');
  assert.notEqual(endpointProviderId('', endpointUrl('https://a.example/v1')), endpointProviderId('', endpointUrl('https://b.example/v1')));
});

test('discovery lists the server\'s models, falls back to a typed model id, and says why when it has neither', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({url: String(url), auth: init.headers.Authorization});
    return new Response(JSON.stringify({data: [{id: 'a', type: 'llm'}, {id: 'b'}]}), {status: 200}); };
  const listed = await discoverEndpointModels(endpointUrl('http://localhost:1234/v1'), 'test-only', undefined, {fetch});
  assert.deepEqual(calls, [{url: 'http://localhost:1234/v1/models', auth: 'Bearer test-only'}]);
  assert.deepEqual(listed, [{id: 'a', name: 'a', input: ['text']}, {id: 'b', name: 'b', input: ['text', 'image']}],
    'an unreported input is offered with images so the image-and-tool test decides');
  const down = async () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await discoverEndpointModels(endpointUrl('http://localhost:1/v1'), undefined, 'typed-model', {fetch: down}),
    [{id: 'typed-model', name: 'typed-model', input: ['text', 'image']}]);
  await assert.rejects(discoverEndpointModels(endpointUrl('http://localhost:1/v1'), undefined, '', {fetch: down}), /could not be reached.*type the model ID/);
  const refused = async () => new Response('no', {status: 401});
  await assert.rejects(discoverEndpointModels(endpointUrl('https://x.example/v1'), 'bad', undefined, {fetch: refused}), /answered 401/);
  const empty = async () => new Response(JSON.stringify({data: []}), {status: 200});
  await assert.rejects(discoverEndpointModels(endpointUrl('https://x.example/v1'), 'k', undefined, {fetch: empty}), /listed no models/);
});

test('a saved endpoint model without a price gets a zero price, so the cost count after a reply cannot crash', () => {
  const saved = {baseUrl: 'https://x.example/v1', api: 'openai-completions', models: [
    {id: 'no-price', name: 'no-price'},
    {id: 'priced', name: 'priced', cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}}]};
  const fixed = withPrices(saved);
  assert.deepEqual(fixed.models[0].cost, {input: 0, output: 0, cacheRead: 0, cacheWrite: 0});
  assert.deepEqual(fixed.models[1].cost, {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}, 'a stated price is kept');
  assert.equal(fixed.baseUrl, saved.baseUrl);
  assert.equal(saved.models[0].cost, undefined, 'the saved object is not changed in place');
  assert.deepEqual(withPrices({baseUrl: 'https://x.example/v1'}), {baseUrl: 'https://x.example/v1'}, 'a connection with no model list is left alone');
});
