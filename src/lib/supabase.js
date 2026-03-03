import { createClient, processLock } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

const SUPABASE_TIMEOUT_MS = 18000
const SUPABASE_READ_RETRY_COUNT = 1
const SUPABASE_RETRY_DELAY_MS = 350
const SUPABASE_READ_CACHE_TTL_MS = 20000
const SUPABASE_READ_CACHE_MAX_ENTRIES = 240
const INFLIGHT_READ_REQUESTS = new Map()
const READ_RESPONSE_CACHE = new Map()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const resolveMethod = (input, init = {}) => {
  if (init.method) return String(init.method).toUpperCase()
  if (input instanceof Request) return String(input.method || 'GET').toUpperCase()
  return 'GET'
}

const isReadMethod = (method) => method === 'GET' || method === 'HEAD'

const toResponseError = (err) => {
  if (err?.name === 'AbortError' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new Error('Network error: You appear to be offline. Reconnect and try again.')
  }

  if (err?.name === 'AbortError') {
    return new Error(`Network timeout: Supabase request exceeded ${Math.floor(SUPABASE_TIMEOUT_MS / 1000)}s.`)
  }

  return new Error('Network error: Unable to reach Supabase. Check internet/VPN/firewall and Supabase project status.')
}

const mergeHeaders = (input, init = {}) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  const override = new Headers(init.headers || undefined)
  override.forEach((value, key) => headers.set(key, value))
  return headers
}

const buildReadKey = (input, init = {}, method = 'GET') => {
  const url = input instanceof Request ? input.url : String(input)
  const headers = mergeHeaders(input, init)
  const pairs = []
  headers.forEach((value, key) => {
    pairs.push(`${key}:${value}`)
  })
  pairs.sort()
  return `${method}:${url}:${pairs.join('|')}`
}

const shouldRetryResponse = (response) => {
  const status = Number(response?.status || 0)
  return status === 408 || status === 429 || status >= 500
}

const getCachedReadResponse = (requestKey) => {
  const cached = READ_RESPONSE_CACHE.get(requestKey)
  if (!cached) return null
  if ((Date.now() - cached.ts) > SUPABASE_READ_CACHE_TTL_MS) {
    READ_RESPONSE_CACHE.delete(requestKey)
    return null
  }
  return cached.response.clone()
}

const cacheReadResponse = (requestKey, response) => {
  if (!response?.ok) return
  READ_RESPONSE_CACHE.set(requestKey, {
    response: response.clone(),
    ts: Date.now(),
  })

  if (READ_RESPONSE_CACHE.size <= SUPABASE_READ_CACHE_MAX_ENTRIES) return
  const oldestKey = READ_RESPONSE_CACHE.keys().next().value
  if (oldestKey) READ_RESPONSE_CACHE.delete(oldestKey)
}

const fetchWithTimeoutAndRetry = async (input, init = {}) => {
  const method = resolveMethod(input, init)
  const canRetry = isReadMethod(method)
  let attempts = 0

  while (attempts <= (canRetry ? SUPABASE_READ_RETRY_COUNT : 0)) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)
    const onAbort = () => controller.abort()

    if (init.signal) {
      if (init.signal.aborted) controller.abort()
      else init.signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      if (canRetry && attempts < SUPABASE_READ_RETRY_COUNT && shouldRetryResponse(response)) {
        attempts += 1
        await delay(SUPABASE_RETRY_DELAY_MS * attempts)
        continue
      }
      return response
    } catch (err) {
      if (canRetry && attempts < SUPABASE_READ_RETRY_COUNT) {
        attempts += 1
        await delay(SUPABASE_RETRY_DELAY_MS * attempts)
        continue
      }
      throw toResponseError(err)
    } finally {
      clearTimeout(timeoutId)
      if (init.signal) init.signal.removeEventListener('abort', onAbort)
    }
  }

  return fetch(input, init)
}

const fetchWithTimeout = async (input, init = {}) => {
  const method = resolveMethod(input, init)
  if (!isReadMethod(method)) {
    return fetchWithTimeoutAndRetry(input, init)
  }

  const requestKey = buildReadKey(input, init, method)
  const activeRequest = INFLIGHT_READ_REQUESTS.get(requestKey)
  if (activeRequest) {
    const sharedResponse = await activeRequest
    return sharedResponse.clone()
  }

  const cachedResponse = getCachedReadResponse(requestKey)
  if (cachedResponse) {
    const staleFallback = cachedResponse.clone()
    const backgroundRefresh = fetchWithTimeoutAndRetry(input, init)
      .then((response) => {
        cacheReadResponse(requestKey, response)
        return response
      })
      .catch(() => staleFallback)
      .finally(() => {
        INFLIGHT_READ_REQUESTS.delete(requestKey)
      })
    INFLIGHT_READ_REQUESTS.set(requestKey, backgroundRefresh)
    return cachedResponse
  }

  const requestPromise = fetchWithTimeoutAndRetry(input, init)
  INFLIGHT_READ_REQUESTS.set(requestKey, requestPromise)

  try {
    const response = await requestPromise
    cacheReadResponse(requestKey, response)
    return response.clone()
  } finally {
    INFLIGHT_READ_REQUESTS.delete(requestKey)
  }
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    global: { fetch: fetchWithTimeout },
    auth: {
      // Use process-level auth locking to avoid browser lock steal races.
      lock: processLock,
    },
  }
)
