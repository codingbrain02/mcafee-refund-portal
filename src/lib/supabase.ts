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
  purchase_date: string | null
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

export type CustomerRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  created_by: string | null
  created_at: string
}

export type UserAccountRow = {
  id: string
  role: UserRole
  full_name: string
  email: string
  mfa_required: boolean
  locked_until: string | null
  email_confirmed_at: string | null
  verification_status: 'pending' | 'verified'
  verification_expires_at: string | null
  created_at: string
}

export type StatusHistoryRow = {
  id: string
  refund_request_id: string
  from_status: string | null
  to_status: string
  employee_id: string | null
  internal_notes: string | null
  created_at: string
}

export type InternalNoteRow = {
  id: string
  refund_request_id: string
  author_id: string
  note: string
  created_at: string
}

export type AuditLogRow = {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type PaymentTransactionRow = {
  id: string
  refund_request_id: string
  provider: string
  transaction_reference: string
  beneficiary_hash: string
  amount: number
  status: string
  error_message: string | null
  created_at: string
  updated_at: string
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
