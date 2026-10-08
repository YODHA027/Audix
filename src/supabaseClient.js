import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vbdxjhtzfzvimaqcwqlx.supabase.co'
const supabaseAnonKey = 'sb_publishable_oLcS5YWnWi4clhEH8Bc83Q_ZQAlxtE4'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)