import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from './runtime/config.js';

const runtimeConfig = getRuntimeConfig();
const resolvedSupabaseUrl = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const resolvedSupabaseKey = runtimeConfig?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!resolvedSupabaseUrl || !resolvedSupabaseKey) {
  throw new Error('Supabase configuration missing. ודא ש-/config זמין או שקובץ ה-.env מוגדר.');
}

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseKey);
export const supabaseConfigSource = runtimeConfig?.source || (resolvedSupabaseUrl && resolvedSupabaseKey ? 'env' : 'unknown');
export const SUPABASE_URL = resolvedSupabaseUrl;
export const SUPABASE_ANON_KEY = resolvedSupabaseKey;
