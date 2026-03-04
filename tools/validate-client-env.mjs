import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const ALLOWED_PUBLIC_KEY_NAMES = new Set([
  'VITE_SUPABASE_ANON_KEY',
  'VITE_WEB_PUSH_PUBLIC_KEY',
]);

const SENSITIVE_NAME_PATTERN = /(SECRET|PRIVATE|SERVICE_ROLE|ADMIN|PASSWORD|PASSWD|ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)/i;
const URL_NAME_PATTERN = /(URL|ORIGIN|BASE_URL)$/i;
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

const parseEnv = (content) => content
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const eq = line.indexOf('=');
    if (eq < 0) return { key: line, value: '' };
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    return { key, value };
  });

const isLocalHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(parsed.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
};

const validate = (entries) => {
  const errors = [];
  const warnings = [];

  for (const { key, value } of entries) {
    if (!key.startsWith('VITE_')) continue;

    if (SENSITIVE_NAME_PATTERN.test(key) && !ALLOWED_PUBLIC_KEY_NAMES.has(key)) {
      errors.push(`${key}: looks like a secret but is client-exposed (VITE_*).`);
    }

    if (URL_NAME_PATTERN.test(key)) {
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (parsed.protocol === 'https:') continue;
        if (isLocalHttpUrl(value)) continue;
        errors.push(`${key}: must use https:// (localhost http:// is allowed only for local dev).`);
      } catch (_) {
        errors.push(`${key}: must be a valid absolute URL.`);
      }
    }
  }

  if (!entries.some((entry) => entry.key === 'VITE_SUPABASE_ANON_KEY')) {
    warnings.push('VITE_SUPABASE_ANON_KEY not found in .env.');
  }

  return { errors, warnings };
};

const main = () => {
  if (!existsSync(ENV_PATH)) {
    console.log('.env not found. Skipping client env validation.');
    return;
  }

  const content = readFileSync(ENV_PATH, 'utf8');
  const entries = parseEnv(content);
  const { errors, warnings } = validate(entries);

  warnings.forEach((message) => {
    console.warn(`Warning: ${message}`);
  });

  if (errors.length) {
    errors.forEach((message) => console.error(`Error: ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log('Client env validation passed.');
};

main();
