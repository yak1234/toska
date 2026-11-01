/** A custom OpenAI-compatible endpoint (a local server, a gateway): its models and what the server says about each.
 * Nothing is assumed. A limit or an input the server does not report is left out, so Pi's own handling applies, and
 * whether a model can paint is decided by the image-and-tool test (model-capabilities.mjs), not by a checkbox. */

export type EndpointModel = { id: string; name: string; input?: string[]; contextWindow?: number; maxTokens?: number; reasoning?: boolean };
type Listing = Record<string, any>;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The endpoint as a URL, refused when it would send a key in the clear or carry credentials in the address. */
export function endpointUrl(baseUrl: string): URL {
  let url: URL;
  try { url = new URL(String(baseUrl ?? '').trim()); } catch { throw new Error('Enter the endpoint as a full address, such as http://localhost:11434/v1.'); }
  if (url.username || url.password) throw new Error('Put credentials in the API key field, not the endpoint.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname)))
    throw new Error('Use an HTTPS endpoint, or a local model server.');
  return url;
}

export const isLocalEndpoint = (url: URL): boolean => LOCAL_HOSTS.includes(url.hostname);

/** A provider id of its own for each endpoint, so two custom servers never share a key or a model list. */
export function endpointProviderId(name: string | undefined, url: URL): string {
  const words = (name?.trim() || url.host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'custom-' + (words || 'endpoint');
}

const positive = (...values: unknown[]): number | undefined => {
  for (const value of values) { const number = Number(value); if (Number.isFinite(number) && number > 0) return Math.round(number); }
  return undefined;
};

/** What one listing entry says about its model. Field names follow the servers that report them: OpenRouter,
 * LM Studio, vLLM, Groq, Together. */
export function describeModel(entry: Listing): EndpointModel | null {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id || /^embeddings?$/i.test(String(entry.type ?? ''))) return null;
  const model: EndpointModel = { id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id };
  const contextWindow = positive(entry.context_length, entry.max_context_length, entry.max_model_len, entry.context_window,
    entry.top_provider?.context_length);
  const maxTokens = positive(entry.top_provider?.max_completion_tokens, entry.max_completion_tokens, entry.max_output_tokens);
  if (contextWindow) model.contextWindow = contextWindow;
  if (maxTokens && (!contextWindow || maxTokens <= contextWindow)) model.maxTokens = maxTokens;
  const modalities = entry.architecture?.input_modalities ?? entry.input_modalities ?? entry.modalities?.input;
  if (Array.isArray(modalities)) model.input = modalities.includes('image') ? ['text', 'image'] : ['text'];
  else if (entry.type === 'vlm' || (Array.isArray(entry.capabilities) && entry.capabilities.includes('vision'))) model.input = ['text', 'image'];
  else if (entry.type === 'llm') model.input = ['text'];
  if (Array.isArray(entry.supported_parameters) && entry.supported_parameters.includes('reasoning')) model.reasoning = true;
  return model;
}

/** The endpoint's models from its /models listing. A model id typed by the artist is used when the server
 * lists nothing; an unreported input is offered as text and image so the capability test can decide. */
export async function discoverEndpointModels(url: URL, apiKey: string | undefined, typedModel: string | undefined,
  { fetch = globalThis.fetch, timeout = 8000 }: { fetch?: typeof globalThis.fetch; timeout?: number } = {}): Promise<EndpointModel[]> {
  const typed = typedModel?.trim();
  let listed: EndpointModel[] = [], failure = '';
  try {
    const response = await fetch(new URL('models', url.href.endsWith('/') ? url.href : url.href + '/'),
      { headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {}, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) failure = `the server answered ${response.status}`;
    else {
      const body: any = await response.json();
      const entries: unknown = Array.isArray(body) ? body : body?.data ?? body?.models;
      listed = (Array.isArray(entries) ? entries : []).map(describeModel).filter((model): model is EndpointModel => !!model);
      if (!listed.length) failure = 'it listed no models';
    }
  } catch (error) { failure = (error as Error)?.name === 'TimeoutError' ? 'it did not answer' : 'it could not be reached'; }
  if (typed) listed = [...listed.filter(model => model.id !== typed), listed.find(model => model.id === typed) ?? { id: typed, name: typed }];
  if (!listed.length) throw new Error(`Could not list the models at ${url.origin}: ${failure}. Check the address, or type the model ID.`);
  return listed.map(model => model.input ? model : { ...model, input: ['text', 'image'] });
}
