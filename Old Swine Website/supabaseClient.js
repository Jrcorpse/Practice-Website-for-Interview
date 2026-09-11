import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// for Login Register Database
const supabaseUrl = 'https://rbrhymbyebsrtreneoeq.supabase.co'
const supabaseKey = 'sb_publishable_obbnT6eRkKLjP0p1DkYbng_iEuhvnDX'
export const supabase = createClient(supabaseUrl, supabaseKey)

// for RPI Data database
const researchUrl = 'https://jfeckxthdwpfmamtobwq.supabase.co'
const researchKey = 'sb_publishable_2_9_ZLW27aZ-GsVqs_3TnQ_ZLapGA9d' 
export const researchSupabase = createClient(researchUrl, researchKey)
