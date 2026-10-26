// localStorage helpers. Every call is wrapped; failures never throw.
const KEYS = {
  game: 'scavenge.game.v1',
  setup: 'scavenge.setup.v1',
  presets: 'scavenge.presets.v1',
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Returns { ok:true } or { ok:false, quota:boolean, error }. */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    const quota = !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014);
    return { ok: false, quota, error };
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const loadGame = () => {
  const g = read(KEYS.game);
  return g && g.version === 1 && Array.isArray(g.cards) && g.config ? g : null;
};
export const saveGame = (state) => write(KEYS.game, state);
export const clearGame = () => remove(KEYS.game);

export const loadSetup = () => read(KEYS.setup);
export const saveSetup = (form) => write(KEYS.setup, form);

/** Saved presets: { [name]: preset } */
export const loadPresets = () => {
  const p = read(KEYS.presets);
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
};
export function savePreset(name, preset) {
  const all = loadPresets();
  all[name] = preset;
  const res = write(KEYS.presets, all);
  return res;
}
export function deletePreset(name) {
  const all = loadPresets();
  delete all[name];
  return write(KEYS.presets, all);
}
