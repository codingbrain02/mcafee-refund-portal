import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const configPath = new URL('../.admin-user.local', import.meta.url)

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const rawConfig = await readFile(configPath, 'utf8')
const config = JSON.parse(rawConfig)

const supabaseUrl = requireValue(config.supabaseUrl, 'supabaseUrl')
const serviceRoleKey = requireValue(config.serviceRoleKey, 'serviceRoleKey')
const email = requireValue(config.email, 'email')
const password = requireValue(config.password, 'password')
const fullName = config.fullName || 'Portal Administrator'
const role = config.role || 'administrator'

if (!['customer', 'refund_manager', 'administrator'].includes(role)) {
  throw new Error('role must be customer, refund_manager, or administrator')
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const { data: createdUser, error: createUserError } =
  await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role,
    },
  })

if (createUserError) {
  throw createUserError
}

const userId = createdUser.user?.id

if (!userId) {
  throw new Error('Supabase did not return a created user id')
}

const { error: profileError } = await adminClient.from('users').upsert({
  id: userId,
  role,
  full_name: fullName,
  email,
  mfa_required: true,
})

if (profileError) {
  throw profileError
}

console.log(`Created ${role} account for ${email}`)
