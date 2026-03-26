import fs from 'node:fs';
import path from 'node:path';

const parseEnv = (raw) => {
  const lines = raw.split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

export const loadLocalEnv = (cwd = process.cwd()) => {
  const files = ['.env.local', '.env'];
  for (const name of files) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
};

