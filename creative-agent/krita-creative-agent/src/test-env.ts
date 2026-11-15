// The environment a test chat may set on its own test companion, so a benchmark run can switch a feature per chat
// (the artist's Toska and the driver keep theirs). An allow-list, never a pass-through: two keys. TOSKA_MIXING switches
// colour mixing off; TOSKA_TRACE_TAG adds one tag to the chat's Langfuse traces (painting-skills 6.1a: wikiart-study).

/** The key naming a study's tag for a test chat's Langfuse traces. */
export const TRACE_TAG_KEY = 'TOSKA_TRACE_TAG';

/** Allowed keys and their allowed values; '' unsets the key (the companion then gets the default, not the driver's own). */
export const TEST_ENV_ALLOWED: Readonly<Record<string, readonly string[]>> = Object.freeze({ TOSKA_MIXING: ['off', ''], [TRACE_TAG_KEY]: ['wikiart-study', ''] });

/** The env map checked and normalised (values trimmed, lower-cased), or an Error naming what is refused. */
export function checkTestEnv(env: unknown): Record<string, string> {
  if (env === null || typeof env !== 'object' || Array.isArray(env))
    throw new Error(`env is a map of environment variables; the allowed keys are ${Object.keys(TEST_ENV_ALLOWED).join(', ')}.`);
  const checked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const allowed = Object.hasOwn(TEST_ENV_ALLOWED, key) ? TEST_ENV_ALLOWED[key] : undefined;
    if (!allowed) throw new Error(`env key ${key} is not allowed for a test chat; the allowed keys are ${Object.keys(TEST_ENV_ALLOWED).join(', ')}.`);
    const text = typeof value === 'string' ? value.trim().toLowerCase() : null;
    if (text === null || !allowed.includes(text))
      throw new Error(`env ${key} must be ${allowed.map(v => v === '' ? 'empty (unset)' : `'${v}'`).join(' or ')}.`);
    checked[key] = text;
  }
  return checked;
}

/** The test companion's environment: the driver's own, the config path, then the checked overrides ('' removes the key). */
export function companionEnv(base: NodeJS.ProcessEnv, configPath: string, overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, KRITA_CREATIVE_CONFIG: configPath };
  for (const [key, value] of Object.entries(overrides ? checkTestEnv(overrides) : {})) { if (value === '') delete env[key]; else env[key] = value; }
  return env;
}

/** The extra Langfuse tags of this companion's traces: the study tag when TOSKA_TRACE_TAG holds an allowed value, else
 * none. Read from the allow-list, so a stray value in someone's shell never becomes a tag. */
export function traceTags(env: NodeJS.ProcessEnv = process.env): string[] {
  const value = env[TRACE_TAG_KEY]?.trim().toLowerCase();
  return value && TEST_ENV_ALLOWED[TRACE_TAG_KEY].includes(value) ? [value] : [];
}
