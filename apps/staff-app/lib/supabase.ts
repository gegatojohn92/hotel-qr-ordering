import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://agerlzhzykgdtpedmudg.supabase.co'
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZXJsemh6eWtnZHRwZWRtdWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwOTUwNjcsImV4cCI6MjEwNTY3MTA2N30.wUnf6ZNtl57MClxdsfY_sCcEvNsEApf8elJ0XOdbgZg'

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  DEFAULT_SUPABASE_URL

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
})
