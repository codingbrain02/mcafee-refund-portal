import { createClient } from '@supabase/supabase-js'

export type UserRole = 'customer' | 'refund_manager' | 'administrator'

export type UserProfile = {
  id: string
  role: UserRole
  full_name: string
  email: string
  mfa_required: boolean
}

export type RefundRequestRow = {
  id: string
  reference_number: string
  order_number: string
  amount_requested: number
  refund_reason: string
  preferred_payment_method: string
  status: string
  assigned_to: string | null
  created_at: string
  customers: {
    full_name: string
    email: string
    phone: string | null
  } | null
}

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl)

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
}
