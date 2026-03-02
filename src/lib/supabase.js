import { createClient, processLock } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

const SUPABASE_TIMEOUT_MS = 12000

const fetchWithTimeout = async (input, init = {}) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)

  if (init.signal) {
    if (init.signal.aborted) {
      controller.abort()
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    const timeoutError = err?.name === 'AbortError'
      ? `Network timeout: Supabase request exceeded ${Math.floor(SUPABASE_TIMEOUT_MS / 1000)}s.`
      : 'Network error: Unable to reach Supabase. Check internet/VPN/firewall and Supabase project status.'
    throw new Error(timeoutError)
  } finally {
    clearTimeout(timeoutId)
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
