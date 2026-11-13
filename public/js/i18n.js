// All visible text lives in /i18n/en.js. To add Telugu later: copy that file to
// te.js, translate the values, and load it here based on the user's choice.
import en from '../i18n/en.js';

const dict = en;

export function t(key, vars) {
  let s = dict[key];
  if (s == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export const has = (key) => dict[key] != null;
