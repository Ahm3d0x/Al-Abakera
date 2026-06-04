import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    'WARNING: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
    'Database operations will fail at runtime.'
  );
}

/**
 * Supabase Admin Client
 * 
 * Uses the service role key for full database access.
 * This client bypasses Row Level Security — use only on the server side.
 * 
 * For user-scoped operations, create a per-request client using
 * the user's JWT with `createClient(url, anonKey, { global: { headers: { Authorization } } })`.
 */
export const supabaseAdmin = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : new Proxy({}, {
      get(target, prop) {
        if (prop === 'then' || prop === 'toJSON' || prop === 'toString' || prop === 'valueOf' || typeof prop === 'symbol') {
          return undefined;
        }
        throw new Error(
          `Supabase is not configured. Cannot access property "${String(prop)}". ` +
          `Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables in your environment/Vercel settings.`
        );
      }
    }) as any;

export { supabaseUrl };
