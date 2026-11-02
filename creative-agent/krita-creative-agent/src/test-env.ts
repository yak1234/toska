// The environment a test chat may set on its own test companion, so a benchmark run can switch a feature per chat
// (the artist's Toska and the driver keep theirs). An allow-list, never a pass-through: one key for now.

/** Allowed keys and their allowed values; '' unsets the key (the companion then gets the default, not the driver's own). */
export const TEST_ENV_ALLOWED: Readonly<Record<string, readonly string[]>> = Object.freeze({ TOSKA_MIXING: ['off', ''] });

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
