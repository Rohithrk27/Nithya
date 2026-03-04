const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

const normalizeInput = (value) => String(value || '').trim();

const isHttpAllowedForLocalhost = (parsedUrl) => {
  const protocol = String(parsedUrl?.protocol || '').toLowerCase();
  const hostname = String(parsedUrl?.hostname || '').toLowerCase();
  return protocol === 'http:' && LOCAL_HTTP_HOSTS.has(hostname);
};

const isHttpsProtocol = (parsedUrl) => String(parsedUrl?.protocol || '').toLowerCase() === 'https:';

export const normalizeSecureUrl = (
  value,
  {
    label = 'URL',
    optional = true,
    allowHttpLocalhost = true,
  } = {},
) => {
  const raw = normalizeInput(value);
  if (!raw) {
    if (optional) return '';
    throw new Error(`Missing required ${label}.`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error(`Invalid ${label}. Expected an absolute URL.`);
  }

  if (isHttpsProtocol(parsed)) return parsed.toString();
  if (allowHttpLocalhost && isHttpAllowedForLocalhost(parsed)) return parsed.toString();

  throw new Error(`${label} must use HTTPS (localhost http:// is allowed for local development only).`);
};
