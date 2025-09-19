import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from './runtime/config.js';

const runtimeConfig = getRuntimeConfig();
const supabaseUrl = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = runtimeConfig?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase configuration missing. ודא ש-/config זמין או שקובץ ה-.env מוגדר.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
export const supabaseConfigSource = runtimeConfig?.source || (supabaseUrl && supabaseKey ? 'env' : 'unknown');
