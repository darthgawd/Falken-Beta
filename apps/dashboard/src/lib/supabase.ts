import { createClient, SupabaseClient } from '@supabase/supabase-js';

// V4 CLEANUP: Clear any legacy V3 session data that might cause 401 conflicts
if (typeof window !== 'undefined') {
  const legacyKeys = [
    'supabase.auth.token',
    'supabase.auth.refreshToken',
    'supabase.auth.expires_at',
    'falken_session',
    'sb-seggybvrqqqdhecwtqoh-auth-token' // Old project key pattern
  ];
  legacyKeys.forEach(key => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (e) {
      // Ignore storage errors
    }
  });
  console.log('SUPABASE_V4: Cleared legacy session data');
}

// V4 FINAL HARDENING: This client is a pure "Guest" and cannot be poisoned by sessions.
function createHardenedClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('SUPABASE_INIT_ERROR: Missing credentials');
    if (typeof window === 'undefined') {
      // Return a mock client for SSR
      return new Proxy({} as SupabaseClient, {
        get(target, prop) {
          if (prop === 'from') {
            return () => ({
              select: () => ({ data: null, error: null }),
              insert: () => ({ data: null, error: null }),
              update: () => ({ data: null, error: null }),
              delete: () => ({ data: null, error: null }),
              eq: () => ({ data: null, error: null }),
              order: () => ({ data: null, error: null }),
              limit: () => ({ data: null, error: null }),
            });
          }
          return target[prop as keyof SupabaseClient];
        },
      });
    }
    throw new Error('Supabase credentials missing. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  console.log('SUPABASE_INIT: Initializing Hardened Guest Client for', supabaseUrl);

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      }
    },
    global: {
      headers: {
        'X-Client-Info': 'falken-dashboard'
      }
    }
  });
  
  return client;
}

// Create singleton instance
let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createHardenedClient();
  }
  return supabaseInstance;
}

// Export singleton for direct use
export const supabase = getSupabaseClient();
