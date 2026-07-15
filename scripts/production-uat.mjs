import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--confirm-production')) {
  throw new Error('Run with --confirm-production to allow temporary UAT records to be created and removed.')
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        let value = line.slice(separator + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        return [key, value]
      }),
  )
}

function requireValue(config, name) {
  const value = process.env[name] || config[name]
  if (!value || value === 'server-only') throw new Error(`${name} is required in .env or the shell environment.`)
  return value
}

function createSessionClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  assert.ok(data.user?.id, `Expected ${email} to sign in.`)
  return data.user.id
}

async function updateStatus(client, requestId, status, assignedTo) {
  return client
    .from('refund_requests')
    .update({ status, assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .select('id,status,assigned_to')
    .single()
}

async function addHistory(client, requestId, employeeId, fromStatus, toStatus) {
  const { error } = await client.from('refund_status_history').insert({
    refund_request_id: requestId,
    from_status: fromStatus,
    to_status: toStatus,
    employee_id: employeeId,
    internal_notes: `Automated UAT: ${fromStatus ?? 'new'} to ${toStatus}`,
  })
  if (error) throw error
}

async function waitForSubscription(channel) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timed out.')), 10000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout)
        resolve()
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout)
        reject(new Error(`Realtime subscription failed with ${status}.`))
      }
    })
  })
}

const config = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
const supabaseUrl = requireValue(config, 'VITE_SUPABASE_URL')
const anonKey = requireValue(config, 'VITE_SUPABASE_ANON_KEY')
const serviceRoleKey = requireValue(config, 'SUPABASE_SERVICE_ROLE_KEY')
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
const password = `Uat-${crypto.randomUUID()}-9a!`
const identities = [
  { email: `uat-customer-${stamp}@example.invalid`, fullName: 'UAT Customer', role: 'customer' },
  { email: `uat-manager-${stamp}@example.invalid`, fullName: 'UAT Manager', role: 'refund_manager' },
  { email: `uat-admin-${stamp}@example.invalid`, fullName: 'UAT Administrator', role: 'administrator' },
]

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const createdUserIds = []
let requestId = null
let customerRecordId = null
let realtimeChannel = null

async function cleanup() {
  if (realtimeChannel) await service.removeChannel(realtimeChannel).catch(() => undefined)

  if (requestId) {
    await service.from('audit_logs').delete().eq('entity_id', requestId)
    await service.from('refund_requests').delete().eq('id', requestId)
  }
  if (customerRecordId) await service.from('customers').delete().eq('id', customerRecordId)
  if (createdUserIds.length) await service.from('audit_logs').delete().in('actor_id', createdUserIds)

  for (const userId of [...createdUserIds].reverse()) {
    const { error } = await service.auth.admin.deleteUser(userId)
    if (error) console.error(`Cleanup warning for temporary user ${userId}: ${error.message}`)
  }

  const { data: remainingProfiles, error: profileCheckError } = await service
    .from('users')
    .select('id')
    .in(
      'email',
      identities.map(({ email }) => email),
    )
  if (profileCheckError) throw profileCheckError
  assert.equal(remainingProfiles.length, 0, 'Temporary UAT user profiles remain after cleanup.')

  if (requestId) {
    const { data: remainingRequests, error: requestCheckError } = await service
      .from('refund_requests')
      .select('id')
      .eq('id', requestId)
    if (requestCheckError) throw requestCheckError
    assert.equal(remainingRequests.length, 0, 'Temporary UAT refund remains after cleanup.')
  }
}

try {
  console.log('Creating isolated UAT identities...')
  for (const identity of identities) {
    const { data, error } = await service.auth.admin.createUser({
      email: identity.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: identity.fullName },
    })
    if (error) throw error
    assert.ok(data.user?.id)
    identity.id = data.user.id
    createdUserIds.push(data.user.id)

    const { error: profileError } = await service
      .from('users')
      .update({ role: identity.role, full_name: identity.fullName })
      .eq('id', identity.id)
    if (profileError) throw profileError
  }

  const customer = createSessionClient(supabaseUrl, anonKey)
  const manager = createSessionClient(supabaseUrl, anonKey)
  const administrator = createSessionClient(supabaseUrl, anonKey)
  await signIn(customer, identities[0].email, password)
  await signIn(manager, identities[1].email, password)
  await signIn(administrator, identities[2].email, password)
  console.log('PASS authentication and role sessions')

  const { data: customerRecord, error: customerError } = await customer
    .from('customers')
    .insert({
      full_name: identities[0].fullName,
      email: identities[0].email,
      phone: '+10000000000',
      created_by: identities[0].id,
    })
    .select('id')
    .single()
  if (customerError) throw customerError
  customerRecordId = customerRecord.id

  const referenceNumber = `UAT-${stamp}`
  const { data: refund, error: refundError } = await customer
    .from('refund_requests')
    .insert({
      customer_id: customerRecordId,
      reference_number: referenceNumber,
      order_number: `ORDER-${stamp}`,
      product_name: 'McAfee',
      purchase_date: new Date().toISOString().slice(0, 10),
      amount_requested: 1,
      refund_reason: 'Automated production acceptance test',
      preferred_payment_method: 'Original payment method',
      created_by: identities[0].id,
    })
    .select('id,status')
    .single()
  if (refundError) throw refundError
  requestId = refund.id
  await addHistory(customer, requestId, identities[0].id, null, 'submitted')
  console.log('PASS customer submission and own-record visibility')

  const { data: customerUsers, error: customerUsersError } = await customer.from('users').select('id')
  if (customerUsersError) throw customerUsersError
  assert.deepEqual(customerUsers.map(({ id }) => id), [identities[0].id])

  const { data: customerAudit, error: customerAuditError } = await customer.from('audit_logs').select('id')
  if (customerAuditError) throw customerAuditError
  assert.equal(customerAudit.length, 0)

  const unauthorizedStatus = await updateStatus(customer, requestId, 'under_review', identities[0].id)
  assert.ok(unauthorizedStatus.error, 'Customer status update should be rejected.')
  console.log('PASS customer authorization boundaries')

  const { data: managerRequests, error: managerRequestsError } = await manager
    .from('refund_requests')
    .select('id,status')
    .eq('id', requestId)
  if (managerRequestsError) throw managerRequestsError
  assert.equal(managerRequests.length, 1)

  const skippedApproval = await updateStatus(manager, requestId, 'approved', identities[1].id)
  assert.ok(skippedApproval.error, 'Skipping directly to approved should be rejected.')

  const started = await updateStatus(manager, requestId, 'under_review', identities[1].id)
  if (started.error) throw started.error
  await addHistory(manager, requestId, identities[1].id, 'submitted', 'under_review')

  const repeated = await updateStatus(manager, requestId, 'under_review', identities[1].id)
  assert.ok(repeated.error, 'Repeating an existing workflow status should be rejected.')

  let realtimeEventResolve
  const realtimeEvent = new Promise((resolve, reject) => {
    realtimeEventResolve = resolve
    setTimeout(() => reject(new Error('Customer did not receive the realtime refund update.')), 10000)
  })
  realtimeChannel = customer
    .channel(`uat-refund-${stamp}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'refund_requests', filter: `id=eq.${requestId}` },
      (payload) => realtimeEventResolve(payload),
    )
  await waitForSubscription(realtimeChannel)

  const verified = await updateStatus(manager, requestId, 'documents_verified', identities[1].id)
  if (verified.error) throw verified.error
  await addHistory(manager, requestId, identities[1].id, 'under_review', 'documents_verified')
  const event = await realtimeEvent
  assert.equal(event.new.status, 'documents_verified')
  console.log('PASS ordered manager workflow and customer realtime update')

  const approved = await updateStatus(manager, requestId, 'approved', identities[1].id)
  if (approved.error) throw approved.error
  await addHistory(manager, requestId, identities[1].id, 'documents_verified', 'approved')

  const { data: roleMutation, error: roleMutationError } = await manager
    .from('users')
    .update({ role: 'administrator' })
    .eq('id', identities[0].id)
    .select('id')
  assert.ok(roleMutationError || roleMutation.length === 0, 'Manager must not be able to change user roles.')

  const { data: adminAudit, error: adminAuditError } = await administrator.from('audit_logs').select('id').limit(1)
  if (adminAuditError) throw adminAuditError
  assert.ok(Array.isArray(adminAudit))

  const { data: adminRoleMutation, error: adminRoleMutationError } = await administrator
    .from('users')
    .update({ role: 'refund_manager' })
    .eq('id', identities[0].id)
    .select('id')
  assert.ok(
    adminRoleMutationError || adminRoleMutation.length === 0,
    'A non-head administrator must not be able to change user roles.',
  )
  console.log('PASS manager and administrator privilege boundaries')

  console.log('UAT PASSED: customer, manager, administrator, workflow, RLS, and realtime checks succeeded.')
} finally {
  console.log('Removing temporary UAT records...')
  await cleanup()
  console.log('Temporary UAT records removed.')
}
