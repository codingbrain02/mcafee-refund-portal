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
let cancellationRequestId = null
let cancellationStoragePath = null
let customerRecordId = null
let realtimeChannel = null

async function cleanup() {
  if (realtimeChannel) await realtimeChannel.unsubscribe().catch(() => undefined)
  if (cancellationStoragePath) {
    await service.storage.from('refund-documents').remove([cancellationStoragePath])
  }

  if (requestId) {
    await service.from('audit_logs').delete().eq('entity_id', requestId)
    await service.from('refund_requests').delete().eq('id', requestId)
  }
  if (cancellationRequestId) {
    await service.from('audit_logs').delete().eq('entity_id', cancellationRequestId)
    await service.from('refund_requests').delete().eq('id', cancellationRequestId)
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

  const orderNumber = `ORDER-${stamp}`
  const { data: submittedRefund, error: submittedRefundError } = await customer.rpc(
    'submit_customer_refund_request_details',
    {
      p_customer_phone: '+1 555 010 2600',
      p_order_number: orderNumber,
      p_preferred_payment_method: 'Original payment method',
      p_product_name: 'McAfee',
      p_purchase_date: new Date().toISOString().slice(0, 10),
      p_requested_amount: 17.25,
      p_refund_reason: 'Automated production acceptance test',
    },
  )
  if (submittedRefundError) throw submittedRefundError
  const submission = Array.isArray(submittedRefund) ? submittedRefund[0] : submittedRefund
  assert.ok(submission?.refund_request_id)
  assert.match(submission.reference_number, /^REF-\d{8}-[A-F0-9]{8}$/)
  requestId = submission.refund_request_id

  const duplicateSubmission = await customer.rpc('submit_customer_refund_request_details', {
    p_customer_phone: '+1 555 010 2600',
    p_order_number: orderNumber,
    p_preferred_payment_method: 'Original payment method',
    p_product_name: 'McAfee',
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_requested_amount: 17.25,
    p_refund_reason: 'Duplicate automated acceptance test',
  })
  assert.ok(duplicateSubmission.error, 'A duplicate customer order request should be rejected.')

  const { data: refund, error: refundError } = await customer
    .from('refund_requests')
    .select('id,status,amount_requested,customer_phone_submitted,customer_purchase_date,customer_requested_amount,customer_preferred_payment_method,reference_number')
    .eq('id', requestId)
    .single()
  if (refundError) throw refundError
  assert.equal(Number(refund.amount_requested), 0)
  assert.equal(Number(refund.customer_requested_amount), 17.25)
  assert.equal(refund.customer_phone_submitted, '+1 555 010 2600')
  assert.equal(refund.customer_purchase_date, new Date().toISOString().slice(0, 10))
  assert.equal(refund.customer_preferred_payment_method, 'Original payment method')

  const { data: customerRecord, error: customerError } = await customer
    .from('customers')
    .select('id')
    .eq('created_by', identities[0].id)
    .single()
  if (customerError) throw customerError
  customerRecordId = customerRecord.id
  console.log('PASS full customer submission, separate requested amount, and duplicate protection')

  const { data: customerUsers, error: customerUsersError } = await customer.from('users').select('id')
  if (customerUsersError) throw customerUsersError
  assert.deepEqual(customerUsers.map(({ id }) => id), [identities[0].id])

  const { data: customerAudit, error: customerAuditError } = await customer.from('audit_logs').select('id')
  if (customerAuditError) throw customerAuditError
  assert.equal(customerAudit.length, 0)

  const { data: headProfile, error: headProfileError } = await service
    .from('users')
    .select('id,email')
    .ilike('email', 'jccodingbrain@gmail.com')
    .single()
  if (headProfileError) throw headProfileError

  const { data: administratorVisibleHead, error: administratorVisibleHeadError } = await administrator
    .from('users')
    .select('id')
    .eq('id', headProfile.id)
  if (administratorVisibleHeadError) throw administratorVisibleHeadError
  assert.equal(administratorVisibleHead.length, 0, 'Ordinary administrator can see the head account.')

  const { data: managerVisibleHead, error: managerVisibleHeadError } = await manager
    .from('users')
    .select('id')
    .eq('id', headProfile.id)
  if (managerVisibleHeadError) throw managerVisibleHeadError
  assert.equal(managerVisibleHead.length, 0, 'Refund manager can see the head account.')
  console.log('PASS exclusive head administrator account visibility')

  const unauthorizedStatus = await updateStatus(customer, requestId, 'under_review', identities[0].id)
  assert.ok(unauthorizedStatus.error, 'Customer status update should be rejected.')
  console.log('PASS customer authorization boundaries')

  const { data: cancellationRequest, error: cancellationRequestError } = await customer
    .from('refund_requests')
    .insert({
      customer_id: customerRecordId,
      reference_number: `UAT-CANCEL-${stamp}`,
      order_number: `ORDER-CANCEL-${stamp}`,
      product_name: 'McAfee',
      purchase_date: new Date().toISOString().slice(0, 10),
      amount_requested: 1,
      refund_reason: 'Automated cancellation acceptance test',
      preferred_payment_method: 'Original payment method',
      created_by: identities[0].id,
    })
    .select('id,status')
    .single()
  if (cancellationRequestError) throw cancellationRequestError
  cancellationRequestId = cancellationRequest.id

  cancellationStoragePath = `${cancellationRequestId}/uat-${stamp}.png`
  const { error: cancellationUploadError } = await customer.storage
    .from('refund-documents')
    .upload(cancellationStoragePath, new Uint8Array([137, 80, 78, 71]), {
      contentType: 'image/png',
    })
  if (cancellationUploadError) throw cancellationUploadError

  const { error: cancellationDocumentError } = await customer.from('refund_documents').insert({
    refund_request_id: cancellationRequestId,
    document_type: 'uat-cancellation.png',
    storage_path: cancellationStoragePath,
    mime_type: 'image/png',
    file_size_bytes: 4,
    uploaded_by: identities[0].id,
  })
  if (cancellationDocumentError) throw cancellationDocumentError

  const unauthorizedCancellation = await manager.rpc('cancel_refund_request', {
    p_refund_request_id: cancellationRequestId,
    p_confirmation: 'Cancel refund request',
  })
  assert.ok(unauthorizedCancellation.error, 'Manager must not cancel a customer-owned request.')

  const cancellationWithStoredDocument = await customer.rpc('cancel_refund_request', {
    p_refund_request_id: cancellationRequestId,
    p_confirmation: 'Cancel refund request',
  })
  assert.ok(
    cancellationWithStoredDocument.error,
    'Cancellation must be blocked until owned storage objects are removed.',
  )

  const { error: cancellationStorageError } = await customer.storage
    .from('refund-documents')
    .remove([cancellationStoragePath])
  if (cancellationStorageError) throw cancellationStorageError
  cancellationStoragePath = null

  const { error: cancellationError } = await customer.rpc('cancel_refund_request', {
    p_refund_request_id: cancellationRequestId,
    p_confirmation: 'Cancel refund request',
  })
  if (cancellationError) throw cancellationError

  const { data: removedCancellation, error: removedCancellationError } = await service
    .from('refund_requests')
    .select('id')
    .eq('id', cancellationRequestId)
  if (removedCancellationError) throw removedCancellationError
  assert.equal(removedCancellation.length, 0, 'Cancelled refund request still exists.')

  const { data: cancellationAudit, error: cancellationAuditError } = await service
    .from('audit_logs')
    .select('entity_id,metadata')
    .eq('actor_id', identities[0].id)
    .eq('action', 'refund_request_cancelled')
    .single()
  if (cancellationAuditError) throw cancellationAuditError
  assert.equal(cancellationAudit.entity_id, null)
  assert.equal(cancellationAudit.metadata.recordRemoved, true)
  cancellationRequestId = null
  console.log('PASS owner-only submitted-request cancellation and permanent cleanup')

  const { data: managerRequests, error: managerRequestsError } = await manager
    .from('refund_requests')
    .select('id,status')
    .eq('id', requestId)
  if (managerRequestsError) throw managerRequestsError
  assert.equal(managerRequests.length, 1)

  const skippedApproval = await updateStatus(manager, requestId, 'approved', identities[1].id)
  assert.ok(skippedApproval.error, 'Skipping directly to approved should be rejected.')

  const { error: verificationError } = await manager.rpc('verify_customer_refund_order', {
    p_refund_request_id: requestId,
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_refund_amount: 17.25,
    p_refund_method: 'Original payment method',
  })
  if (verificationError) throw verificationError

  const { data: verifiedOrderRequest, error: verifiedOrderRequestError } = await manager
    .from('refund_requests')
    .select('amount_requested,preferred_payment_method,purchase_date')
    .eq('id', requestId)
    .single()
  if (verifiedOrderRequestError) throw verifiedOrderRequestError
  assert.equal(Number(verifiedOrderRequest.amount_requested), 17.25)
  assert.equal(verifiedOrderRequest.preferred_payment_method, 'Original payment method')
  assert.ok(verifiedOrderRequest.purchase_date)
  console.log('PASS staff verification of customer-submitted order details')

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
