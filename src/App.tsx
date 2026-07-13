import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  type AuditLogRow,
  hasSupabaseConfig,
  type InternalNoteRow,
  type PaymentTransactionRow,
  supabase,
  type RefundRequestRow,
  type StatusHistoryRow,
  type UserAccountRow,
  type UserProfile,
  type UserRole,
} from './lib/supabase'
import './App.css'

type PortalView = 'customer' | 'manager' | 'admin' | 'bank'
type AuthMode = 'sign-in' | 'sign-up'
type NoticeKind = 'info' | 'success' | 'error'
type RefundStatus =
  | 'submitted'
  | 'under_review'
  | 'documents_verified'
  | 'approved'
  | 'rejected'
  | 'payment_processing'
  | 'completed'

type Notice = {
  kind: NoticeKind
  message: string
}

type ManagerWorkflowTarget = 'under_review' | 'documents_verified' | 'approved'

const workflow = [
  'Customer Submitted',
  'Document Verification',
  'Manager Review',
  'Approval',
  'Bank Payment Processing',
  'Completed',
]

const bankStatuses = ['queued', 'submitted', 'settled', 'failed']
const headAdministratorEmail = 'jccodingbrain@gmail.com'

const managerWorkflowActionRank: Record<ManagerWorkflowTarget, number> = {
  under_review: 1,
  documents_verified: 2,
  approved: 3,
}

const requestStatusRank: Partial<Record<RefundStatus, number>> = {
  submitted: 0,
  under_review: 1,
  documents_verified: 2,
  approved: 3,
  payment_processing: 4,
  completed: 5,
}

const viewLabels: Record<PortalView, string> = {
  customer: 'customer',
  manager: 'manager',
  admin: 'admin',
  bank: 'bank',
}

function App() {
  const [view, setView] = useState<PortalView>('customer')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [signupFullName, setSignupFullName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [customerDialog, setCustomerDialog] = useState<Notice | null>(null)
  const [deleteTargetUser, setDeleteTargetUser] = useState<UserAccountRow | null>(null)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [isDeletingUser, setIsDeletingUser] = useState(false)
  const [isSessionRestoring, setIsSessionRestoring] = useState(hasSupabaseConfig)
  const [notice, setNotice] = useState<Notice>({
    kind: hasSupabaseConfig ? 'info' : 'error',
    message: hasSupabaseConfig
      ? 'Sign in to access the refund portal.'
      : 'Portal configuration is incomplete.',
  })
  const [isAuthLoading, setIsAuthLoading] = useState(false)
  const [isResetLoading, setIsResetLoading] = useState(false)
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [otpEnabled, setOtpEnabled] = useState(true)
  const [requests, setRequests] = useState<RefundRequestRow[]>([])
  const [users, setUsers] = useState<UserAccountRow[]>([])
  const [statusHistory, setStatusHistory] = useState<StatusHistoryRow[]>([])
  const [internalNotes, setInternalNotes] = useState<InternalNoteRow[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([])
  const [paymentTransactions, setPaymentTransactions] = useState<PaymentTransactionRow[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [transactionReference, setTransactionReference] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('submitted')
  const [actionLoading, setActionLoading] = useState('')

  const allowedViews = useMemo(() => getAllowedViews(profile?.role), [profile])
  const activeView = allowedViews.includes(view) ? view : allowedViews[0]

  useEffect(() => {
    const client = supabase
    if (!client) return
    const auth = client.auth

    let isMounted = true

    async function loadSession() {
      const isRecoveringPassword = isRecoveryUrl()

      if (isRecoveringPassword) {
        setIsPasswordRecovery(true)
        setNotice({ kind: 'info', message: 'Create a new password to finish account recovery.' })
      }

      try {
        const { data } = await auth.getSession()
        if (!isMounted) return
        if (isRecoveringPassword) return
        await loadProfile(data.session?.user.id ?? null)
      } finally {
        if (isMounted) {
          setIsSessionRestoring(false)
        }
      }
    }

    const {
      data: { subscription },
    } = auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
        setIsSessionRestoring(false)
        setProfile(null)
        setRequests([])
        setNotice({ kind: 'info', message: 'Create a new password to finish account recovery.' })
        return
      }

      if (session?.user.id) {
        setIsSessionRestoring(true)
        void loadProfile(session.user.id).finally(() => setIsSessionRestoring(false))
        return
      }

      setIsSessionRestoring(false)
      void loadProfile(null)
    })

    void loadSession()

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (profile) {
      void loadRefundRequests()
      void loadStatusHistory()
    }
  }, [profile])

  useEffect(() => {
    if (profile?.role === 'administrator' || profile?.role === 'refund_manager') {
      void loadInternalNotes()
      void loadPaymentTransactions()
      void loadUsers()
    }

    if (profile?.role === 'administrator') {
      void loadAuditLogs()
    }
  }, [profile?.role])

  useEffect(() => {
    const client = supabase
    if (!client || !profile) return

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const queueRealtimeRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }

      refreshTimer = setTimeout(() => {
        void refreshRealtimeData(profile.role)
      }, 180)
    }

    const channel = client
      .channel(`portal-realtime-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_requests' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_status_history' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_notes' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, queueRealtimeRefresh)
      .subscribe()

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }

      void client.removeChannel(channel)
    }
    // The loader functions intentionally read the latest role-scoped state when realtime fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const managerStats = useMemo(() => {
    const newRequests = requests.filter((request) => request.status === 'submitted').length
    const pending = requests.filter((request) =>
      ['under_review', 'documents_verified'].includes(request.status),
    ).length
    const approved = requests.filter((request) => request.status === 'approved').length
    const declined = requests.filter((request) => request.status === 'rejected').length

    return [
      ['New Refund Requests', String(newRequests)],
      ['Pending Verification', String(pending)],
      ['Approved Refunds', String(approved)],
      ['Declined Requests', String(declined)],
    ]
  }, [requests])

  const filteredRequests = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return requests

    return requests.filter((request) =>
      [
        request.reference_number,
        request.order_number,
        request.status,
        request.customers?.full_name,
        request.customers?.email,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    )
  }, [requests, searchTerm])

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? requests[0] ?? null,
    [requests, selectedRequestId],
  )

  const paymentReadyRequests = useMemo(
    () =>
      requests.filter((request) =>
        ['approved', 'payment_processing', 'completed'].includes(request.status),
      ),
    [requests],
  )

  const selectedPaymentRequest = useMemo(
    () =>
      paymentReadyRequests.find((request) => request.id === selectedRequestId) ??
      paymentReadyRequests[0] ??
      null,
    [paymentReadyRequests, selectedRequestId],
  )

  const selectedPaymentTransaction = useMemo(
    () =>
      paymentTransactions.find(
        (transaction) => transaction.refund_request_id === selectedPaymentRequest?.id,
      ) ?? null,
    [paymentTransactions, selectedPaymentRequest?.id],
  )

  const selectedTimeline = useMemo(() => {
    if (!selectedRequest) return []

    const historyItems = statusHistory
      .filter((item) => item.refund_request_id === selectedRequest.id)
      .map((item) => ({
        id: item.id,
        createdAt: item.created_at,
        label: `Status changed to ${formatStatus(item.to_status)}`,
        detail: item.internal_notes ?? 'Workflow status updated.',
      }))

    const noteItems = internalNotes
      .filter((item) => item.refund_request_id === selectedRequest.id)
      .map((item) => ({
        id: item.id,
        createdAt: item.created_at,
        label: 'Internal note',
        detail: item.note,
      }))

    return [...historyItems, ...noteItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [internalNotes, selectedRequest, statusHistory])

  const selectedStatusHistory = useMemo(
    () =>
      selectedRequest
        ? statusHistory.filter((item) => item.refund_request_id === selectedRequest.id)
        : [],
    [selectedRequest, statusHistory],
  )

  const managerWorkflowActionStates = useMemo(
    () => ({
      under_review: getManagerWorkflowActionState(
        selectedRequest,
        selectedStatusHistory,
        'under_review',
      ),
      documents_verified: getManagerWorkflowActionState(
        selectedRequest,
        selectedStatusHistory,
        'documents_verified',
      ),
      approved: getManagerWorkflowActionState(selectedRequest, selectedStatusHistory, 'approved'),
    }),
    [selectedRequest, selectedStatusHistory],
  )

  const registeredCustomerAccounts = useMemo(
    () => users.filter((user) => user.role === 'customer'),
    [users],
  )

  const pendingVerificationAccounts = useMemo(
    () => users.filter((user) => getVerificationStatus(user) === 'pending'),
    [users],
  )

  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  )

  const adminMetrics = useMemo(
    () => [
      ['User accounts', String(users.length)],
      ['Customer accounts', String(registeredCustomerAccounts.length)],
      ['Pending verification', String(pendingVerificationAccounts.length)],
      ['Audit events', String(auditLogs.length)],
    ],
    [auditLogs.length, pendingVerificationAccounts.length, registeredCustomerAccounts.length, users.length],
  )

  const auditEntries = useMemo(
    () => auditLogs.map((event) => formatAuditEntry(event, usersById)),
    [auditLogs, usersById],
  )

  const paymentEta = useMemo(() => {
    const amount = Number(selectedPaymentRequest?.amount_requested ?? refundAmount) || 0
    if (!amount) return 'Awaiting amount'
    return amount > 1000 ? 'Manual bank review required' : '2 business days'
  }, [refundAmount, selectedPaymentRequest?.amount_requested])

  async function loadProfile(userId: string | null) {
    if (!supabase || !userId) {
      setProfile(null)
      setRequests([])
      setUsers([])
      setStatusHistory([])
      setInternalNotes([])
      setAuditLogs([])
      setPaymentTransactions([])
      setSelectedRequestId('')
      return
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, role, full_name, email, mfa_required')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    if (!data) {
      const { data: authUser } = await supabase.auth.getUser()
      const email = authUser.user?.email ?? ''
      const fallbackProfile = {
        id: userId,
        role: 'customer',
        full_name: email || 'Customer',
        email,
        mfa_required: false,
      } satisfies UserProfile
      const { error: profileError } = await supabase.from('users').insert(fallbackProfile)

      if (profileError) {
        setNotice({
          kind: 'error',
          message: 'Signed in, but the customer profile could not be created.',
        })
        setProfile(fallbackProfile)
        return
      }

      setProfile(fallbackProfile)
      setNotice({ kind: 'success', message: 'Signed in as customer.' })
      return
    }

    setProfile(data as UserProfile)
    setNotice({
      kind: 'success',
      message: `Signed in as ${(data as UserProfile).role.replace('_', ' ')}.`,
    })
  }

  async function loadRefundRequests() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('refund_requests')
      .select(
        'id, reference_number, order_number, purchase_date, amount_requested, refund_reason, preferred_payment_method, status, assigned_to, created_at, customers(full_name, email, phone)',
      )
      .order('created_at', { ascending: false })
      .limit(25)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setRequests(
      (data ?? []).map((request) => ({
        ...request,
        customers: Array.isArray(request.customers)
          ? (request.customers[0] ?? null)
          : request.customers,
      })) as RefundRequestRow[],
    )
  }

  async function loadUsers() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('users')
      .select(
        'id, role, full_name, email, mfa_required, locked_until, email_confirmed_at, verification_status, verification_expires_at, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setUsers((data ?? []) as UserAccountRow[])
  }

  async function loadStatusHistory() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('refund_status_history')
      .select('id, refund_request_id, from_status, to_status, employee_id, internal_notes, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setStatusHistory((data ?? []) as StatusHistoryRow[])
  }

  async function loadInternalNotes() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('internal_notes')
      .select('id, refund_request_id, author_id, note, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setInternalNotes((data ?? []) as InternalNoteRow[])
  }

  async function loadAuditLogs() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setAuditLogs((data ?? []) as AuditLogRow[])
  }

  async function loadPaymentTransactions() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('payment_transactions')
      .select(
        'id, refund_request_id, provider, transaction_reference, beneficiary_hash, amount, status, error_message, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setPaymentTransactions((data ?? []) as PaymentTransactionRow[])
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setIsAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    })
    setIsAuthLoading(false)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setAuthPassword('')
    setOtpCode('')
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const email = authEmail.trim().toLowerCase()
    const fullName = signupFullName.trim()

    if (!fullName || !email || authPassword.length < 8) {
      setNotice({ kind: 'error', message: 'Enter your name, email, and an 8-character password.' })
      return
    }

    setIsAuthLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password: authPassword,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })
    setIsAuthLoading(false)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setAuthPassword('')

    if (data.session?.user.id) {
      await loadProfile(data.session.user.id)
      return
    }

    setAuthMode('sign-in')
    setNotice({ kind: 'success', message: 'Account created. Check your email before signing in.' })
  }

  async function handlePasswordReset() {
    const email = authEmail.trim().toLowerCase()

    if (!supabase || !email) {
      setNotice({ kind: 'error', message: 'Enter your email before requesting a reset link.' })
      return
    }

    const redirectTo = getPasswordResetRedirectUrl()

    setIsResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setIsResetLoading(false)

    setNotice(
      error
        ? { kind: 'error', message: error.message }
        : { kind: 'success', message: 'Password reset email sent. Check your inbox.' },
    )
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase) return

    if (newPassword.length < 8) {
      setNotice({ kind: 'error', message: 'Password must be at least 8 characters.' })
      return
    }

    if (newPassword !== confirmPassword) {
      setNotice({ kind: 'error', message: 'Passwords do not match.' })
      return
    }

    setIsResetLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setIsResetLoading(false)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setIsPasswordRecovery(false)
    setNewPassword('')
    setConfirmPassword('')
    setAuthPassword('')
    clearRecoveryUrl()
    await supabase.auth.signOut()
    setProfile(null)
    setRequests([])
    setNotice({ kind: 'success', message: 'Password updated. Sign in with your new password.' })
  }

  async function handleCancelPasswordRecovery() {
    setIsPasswordRecovery(false)
    setNewPassword('')
    setConfirmPassword('')
    clearRecoveryUrl()

    if (supabase) {
      await supabase.auth.signOut()
    }

    setNotice({ kind: 'info', message: 'Sign in to access the refund portal.' })
  }

  async function handleSignOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setProfile(null)
    setRequests([])
    setUsers([])
    setStatusHistory([])
    setInternalNotes([])
    setAuditLogs([])
    setPaymentTransactions([])
    setSelectedRequestId('')
    setView('customer')
    setNotice({ kind: 'info', message: 'Signed out.' })
  }

  async function handleRefundSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const form = new FormData(event.currentTarget)
    const files = form.getAll('documents').filter((file): file is File => file instanceof File)
    const fullName = String(form.get('fullName') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    const phone = String(form.get('phone') ?? '').trim()
    const referenceNumber = String(form.get('referenceNumber') ?? '').trim()
    const orderNumber = String(form.get('orderNumber') ?? '').trim()
    const purchaseDate = String(form.get('purchaseDate') ?? '')
    const refundReason = String(form.get('refundReason') ?? '')
    const preferredPaymentMethod = String(form.get('preferredPaymentMethod') ?? '')
    const amount = Number(form.get('amountRequested'))

    if (!profile) {
      showCustomerDialog(
        'error',
        'Please sign in or create a customer account before submitting a refund request.',
      )
      return
    }

    if (!fullName || !email || !referenceNumber || !orderNumber || !amount) {
      showCustomerDialog('error', 'Please complete the required refund details before submitting.')
      return
    }

    setIsSubmittingRefund(true)

    const { data: userData } = await supabase.auth.getUser()
    const createdBy = userData.user?.id ?? null

    const { data: existingCustomers, error: existingCustomerError } = await supabase
      .from('customers')
      .select('id')
      .eq('created_by', createdBy)
      .eq('email', email)
      .order('created_at', { ascending: true })
      .limit(1)

    if (existingCustomerError) {
      setIsSubmittingRefund(false)
      showCustomerDialog('error', getCustomerFriendlyError(existingCustomerError.message))
      return
    }

    let customerId = existingCustomers?.[0]?.id

    if (!customerId) {
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .insert({
          full_name: fullName,
          email,
          phone,
          created_by: createdBy,
        })
        .select('id')
        .single()

      if (customerError) {
        setIsSubmittingRefund(false)
        showCustomerDialog('error', getCustomerFriendlyError(customerError.message))
        return
      }

      customerId = customer.id
    }

    const { data: refund, error: refundError } = await supabase
      .from('refund_requests')
      .insert({
        customer_id: customerId,
        reference_number: referenceNumber,
        order_number: orderNumber,
        purchase_date: purchaseDate || null,
        amount_requested: amount,
        refund_reason: refundReason,
        preferred_payment_method: preferredPaymentMethod,
        created_by: createdBy,
      })
      .select('id')
      .single()

    if (refundError) {
      setIsSubmittingRefund(false)
      showCustomerDialog('error', getCustomerFriendlyError(refundError.message))
      return
    }

    await supabase.from('refund_status_history').insert({
      refund_request_id: refund.id,
      from_status: null,
      to_status: 'submitted',
      employee_id: createdBy,
      internal_notes: 'Customer submitted refund request.',
    })

    for (const file of files) {
      if (file.size === 0) continue

      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        showCustomerDialog('error', `${file.name} must be a PDF, JPG, or PNG file.`)
        continue
      }

      if (file.size > 10 * 1024 * 1024) {
        showCustomerDialog('error', `${file.name} is larger than the 10 MB upload limit.`)
        continue
      }

      const storagePath = `${refund.id}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('refund-documents')
        .upload(storagePath, file)

      if (uploadError) {
        showCustomerDialog('error', getCustomerFriendlyError(uploadError.message))
        continue
      }

      const { error: documentError } = await supabase.from('refund_documents').insert({
        refund_request_id: refund.id,
        document_type: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        file_size_bytes: file.size,
        uploaded_by: createdBy,
      })

      if (documentError) {
        showCustomerDialog('error', getCustomerFriendlyError(documentError.message))
      }
    }

    setIsSubmittingRefund(false)
    event.currentTarget.reset()
    setRefundAmount('')
    showCustomerDialog(
      'success',
      `Refund request ${referenceNumber} was submitted. You can track it from My refund requests.`,
    )
    await logAudit('refund_submitted', 'refund_request', refund.id, { referenceNumber })
    await loadRefundRequests()
    await loadStatusHistory()
  }

  function showCustomerDialog(kind: NoticeKind, message: string) {
    setCustomerDialog({ kind, message })
  }

  async function changeRequestStatus(
    request: RefundRequestRow | null,
    nextStatus: RefundStatus,
    fallbackNote: string,
  ) {
    if (!supabase || !profile || !request) return

    if (isManagerWorkflowTarget(nextStatus)) {
      const actionState = getManagerWorkflowActionState(
        request,
        statusHistory.filter((item) => item.refund_request_id === request.id),
        nextStatus,
      )

      if (actionState.disabled) {
        setNotice({ kind: 'info', message: actionState.reason })
        return
      }
    }

    const note = internalNote.trim() || fallbackNote
    setActionLoading(nextStatus)

    const { error } = await supabase
      .from('refund_requests')
      .update({
        status: nextStatus,
        assigned_to: profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.id)

    if (error) {
      setActionLoading('')
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await supabase.from('refund_status_history').insert({
      refund_request_id: request.id,
      from_status: request.status,
      to_status: nextStatus,
      employee_id: profile.id,
      internal_notes: note,
    })

    if (internalNote.trim()) {
      await supabase.from('internal_notes').insert({
        refund_request_id: request.id,
        author_id: profile.id,
        note: internalNote.trim(),
      })
      setInternalNote('')
    }

    await logAudit('refund_status_changed', 'refund_request', request.id, {
      from: request.status,
      referenceNumber: request.reference_number,
      to: nextStatus,
    })

    await refreshOperations()
    setActionLoading('')
    setNotice({ kind: 'success', message: `Request moved to ${formatStatus(nextStatus)}.` })
  }

  async function handleSaveInternalNote() {
    if (!supabase || !profile || !selectedRequest || !internalNote.trim()) {
      setNotice({ kind: 'error', message: 'Select a request and enter a note first.' })
      return
    }

    setActionLoading('note')
    const { error } = await supabase.from('internal_notes').insert({
      refund_request_id: selectedRequest.id,
      author_id: profile.id,
      note: internalNote.trim(),
    })

    if (error) {
      setActionLoading('')
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await logAudit('internal_note_added', 'refund_request', selectedRequest.id, {
      referenceNumber: selectedRequest.reference_number,
    })
    await loadInternalNotes()
    setInternalNote('')
    setActionLoading('')
    setNotice({ kind: 'success', message: 'Internal note saved.' })
  }

  async function handleUpdateUserRole(user: UserAccountRow, role: UserRole) {
    if (!supabase || !profile) return

    if (isHeadAdministrator(user.email)) {
      setNotice({
        kind: 'info',
        message: 'The head administrator account is protected and cannot be changed.',
      })
      return
    }

    const { error } = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await logAudit('user_role_updated', 'user', user.id, {
      field: 'role',
      from: user.role,
      targetEmail: user.email,
      targetName: user.full_name,
      to: role,
    })
    await loadUsers()
    setNotice({ kind: 'success', message: `${user.full_name} is now ${role.replace('_', ' ')}.` })
  }

  async function handleToggleMfa(user: UserAccountRow, required: boolean) {
    if (!supabase) return

    if (isHeadAdministrator(user.email)) {
      setNotice({
        kind: 'info',
        message: 'The head administrator account is protected and cannot be changed.',
      })
      return
    }

    const { error } = await supabase
      .from('users')
      .update({ mfa_required: required, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await logAudit('user_mfa_updated', 'user', user.id, {
      field: 'MFA requirement',
      from: user.mfa_required ? 'required' : 'not required',
      required,
      targetEmail: user.email,
      targetName: user.full_name,
      to: required ? 'required' : 'not required',
    })
    await loadUsers()
    setNotice({ kind: 'success', message: 'MFA setting updated.' })
  }

  async function handleDeleteUserAccount() {
    if (!supabase || !profile || !deleteTargetUser) return

    if (isHeadAdministrator(deleteTargetUser.email)) {
      setNotice({
        kind: 'info',
        message: 'The head administrator account is protected and cannot be deleted.',
      })
      return
    }

    if (deleteTargetUser.id === profile.id) {
      setNotice({ kind: 'error', message: 'You cannot delete the account for the active session.' })
      return
    }

    if (deleteConfirmationText !== 'Delete user account') {
      setNotice({
        kind: 'error',
        message: 'Type Delete user account exactly to confirm this action.',
      })
      return
    }

    setIsDeletingUser(true)

    const { error } = await supabase.rpc('delete_user_account', {
      confirmation: deleteConfirmationText,
      target_user_id: deleteTargetUser.id,
    })

    setIsDeletingUser(false)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await loadUsers()
    await loadAuditLogs()
    setDeleteTargetUser(null)
    setDeleteConfirmationText('')
    setNotice({ kind: 'success', message: `${deleteTargetUser.email} was deleted from the portal.` })
  }

  async function handleCreatePayment() {
    if (!supabase || !profile || !selectedPaymentRequest) {
      setNotice({ kind: 'error', message: 'Select an approved request before creating payment.' })
      return
    }

    if (selectedPaymentTransaction) {
      setNotice({ kind: 'info', message: 'This refund already has a payment transaction.' })
      return
    }

    const beneficiary = beneficiaryName.trim()
    const reference =
      transactionReference.trim() ||
      `PAY-${selectedPaymentRequest.reference_number}-${Date.now().toString().slice(-6)}`

    if (!beneficiary) {
      setNotice({ kind: 'error', message: 'Enter the beneficiary name before submitting payment.' })
      return
    }

    setActionLoading('payment')
    const beneficiaryHash = await createBeneficiaryHash(beneficiary)
    const { error } = await supabase.from('payment_transactions').insert({
      refund_request_id: selectedPaymentRequest.id,
      provider: 'authorized_bank_api',
      transaction_reference: reference,
      beneficiary_hash: beneficiaryHash,
      amount: selectedPaymentRequest.amount_requested,
      status: 'submitted',
    })

    if (error) {
      setActionLoading('')
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await changeRequestStatus(
      selectedPaymentRequest,
      'payment_processing',
      `Payment request ${reference} submitted to authorized banking API.`,
    )
    setBeneficiaryName('')
    setTransactionReference('')
    setPaymentStatus('submitted')
    await loadPaymentTransactions()
    setActionLoading('')
  }

  async function handleUpdatePaymentStatus() {
    if (!supabase || !selectedPaymentTransaction) {
      setNotice({ kind: 'error', message: 'Create or select a payment transaction first.' })
      return
    }

    setActionLoading('payment-status')
    const { error } = await supabase
      .from('payment_transactions')
      .update({ status: paymentStatus, updated_at: new Date().toISOString() })
      .eq('id', selectedPaymentTransaction.id)

    if (error) {
      setActionLoading('')
      setNotice({ kind: 'error', message: error.message })
      return
    }

    await logAudit('payment_status_updated', 'payment_transaction', selectedPaymentTransaction.id, {
      from: selectedPaymentTransaction.status,
      referenceNumber: selectedPaymentRequest?.reference_number,
      status: paymentStatus,
      to: paymentStatus,
      transactionReference: selectedPaymentTransaction.transaction_reference,
    })

    if (paymentStatus === 'settled' && selectedPaymentRequest) {
      await changeRequestStatus(
        selectedPaymentRequest,
        'completed',
        `Payment ${selectedPaymentTransaction.transaction_reference} settled.`,
      )
    }

    await refreshOperations()
    setActionLoading('')
    setNotice({ kind: 'success', message: 'Payment status updated.' })
  }

  function handleExportReports() {
    const headers = ['Reference', 'Customer', 'Email', 'Order', 'Amount', 'Status', 'Created']
    const rows = filteredRequests.map((request) => [
      request.reference_number,
      request.customers?.full_name ?? '',
      request.customers?.email ?? '',
      request.order_number,
      Number(request.amount_requested).toFixed(2),
      formatStatus(request.status),
      formatDate(request.created_at),
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `refund-report-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    void logAudit('refund_report_exported', 'refund_request', null, {
      count: rows.length,
      exportedAt: new Date().toISOString(),
    })
  }

  async function refreshOperations() {
    await loadRefundRequests()
    await loadStatusHistory()

    if (profile?.role === 'administrator' || profile?.role === 'refund_manager') {
      await loadInternalNotes()
      await loadPaymentTransactions()
      await loadUsers()
    }

    if (profile?.role === 'administrator') {
      await loadAuditLogs()
    }
  }

  async function refreshRealtimeData(role: UserRole) {
    await loadRefundRequests()
    await loadStatusHistory()

    if (role === 'administrator' || role === 'refund_manager') {
      await loadInternalNotes()
      await loadPaymentTransactions()
      await loadUsers()
    }

    if (role === 'administrator') {
      await loadAuditLogs()
    }
  }

  async function logAudit(
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ) {
    if (!supabase || !profile) return

    await supabase.from('audit_logs').insert({
      actor_id: profile.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: {
        ...metadata,
        actorEmail: profile.email,
        actorName: profile.full_name,
        recordedAt: new Date().toISOString(),
      },
    })
  }

  return (
    <main className="app-shell">
      <section className="login-panel" aria-label="Secure employee login">
        <div className="brand-lockup">
          <img
            alt="McAfee"
            className="brand-mark"
            height="44"
            src="/mcafee-icon.png"
            width="44"
          />
          <div>
            <strong>McAfee Refund Processing Portal</strong>
            <small>For authorized customer refund operations</small>
          </div>
        </div>

        {isPasswordRecovery ? (
          <form className="login-card" onSubmit={handlePasswordUpdate}>
            <label>
              New password
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              Confirm password
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            <button disabled={!hasSupabaseConfig || isResetLoading} type="submit">
              {isResetLoading ? 'Updating...' : 'Update password'}
            </button>
            <div className="login-actions">
              <span>Return to employee login</span>
              <button
                className="reset-password-button"
                onClick={handleCancelPasswordRecovery}
                type="button"
              >
                Back to sign in
              </button>
            </div>
          </form>
        ) : isSessionRestoring ? (
          <div className="account-summary session-restore-card">
            <span>Restoring session</span>
            <strong>Checking saved access</strong>
            <small>You will stay signed in on this browser.</small>
          </div>
        ) : !profile ? (
          <form
            className="login-card"
            onSubmit={authMode === 'sign-up' ? handleSignUp : handleSignIn}
          >
            <div className="auth-switch" aria-label="Account action">
              <button
                className={authMode === 'sign-in' ? 'active' : ''}
                onClick={() => setAuthMode('sign-in')}
                type="button"
              >
                Sign in
              </button>
              <button
                className={authMode === 'sign-up' ? 'active' : ''}
                onClick={() => setAuthMode('sign-up')}
                type="button"
              >
                Create account
              </button>
            </div>
            {authMode === 'sign-up' && (
              <label>
                Full Name
                <input
                  autoComplete="name"
                  onChange={(event) => setSignupFullName(event.target.value)}
                  required
                  type="text"
                  value={signupFullName}
                />
              </label>
            )}
            <label>
              Email
              <input
                autoComplete="username"
                onChange={(event) => setAuthEmail(event.target.value)}
                required
                type="email"
                value={authEmail}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                onChange={(event) => setAuthPassword(event.target.value)}
                required
                type="password"
                value={authPassword}
              />
            </label>
            {authMode === 'sign-in' && (
              <label>
                Two-factor authentication (OTP)
                <input
                  inputMode="numeric"
                  onChange={(event) => setOtpCode(event.target.value)}
                  placeholder="6-digit code"
                  value={otpCode}
                />
              </label>
            )}
            <button disabled={!hasSupabaseConfig || isAuthLoading || isResetLoading} type="submit">
              {isAuthLoading
                ? authMode === 'sign-up'
                  ? 'Creating...'
                  : 'Signing in...'
                : authMode === 'sign-up'
                  ? 'Create customer account'
                  : 'Sign in'}
            </button>
            {authMode === 'sign-in' && (
              <div className="login-actions">
                <span>Need access help?</span>
                <button
                  className="reset-password-button"
                  disabled={isResetLoading}
                  onClick={handlePasswordReset}
                  type="button"
                >
                  {isResetLoading ? 'Sending...' : 'Reset password'}
                </button>
              </div>
            )}
          </form>
        ) : (
          <div className="account-summary">
            <span>Active session</span>
            <strong>{profile.role.replace('_', ' ')}</strong>
          </div>
        )}

        {profile && (
          <div className="session-card">
            <span>Signed in</span>
            <strong>{profile.full_name}</strong>
            <small>{profile.role.replace('_', ' ')}</small>
            <button onClick={handleSignOut} type="button">
              Sign out
            </button>
          </div>
        )}

        <p className={`notice ${notice.kind}`}>{notice.message}</p>
      </section>

      <section className="portal-panel">
        <header className="portal-header">
          <div>
            <p className="eyebrow">Secure refund operations</p>
            <h1>Refund Management Portal</h1>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Portal sections">
          {allowedViews.map((tab) => (
            <button
              className={activeView === tab ? 'active' : ''}
              aria-current={activeView === tab ? 'page' : undefined}
              key={tab}
              onClick={() => setView(tab)}
              type="button"
            >
              {viewLabels[tab]}
            </button>
          ))}
        </nav>

        {activeView === 'customer' && (
          <section className="content-grid">
            <form
              className="work-card form-grid"
              key={profile?.id ?? 'guest-refund-form'}
              onSubmit={handleRefundSubmit}
            >
              <div className="section-heading">
                <p className="eyebrow">Customer refund form</p>
                <h2>Submit request</h2>
              </div>
              {!profile && (
                <p className="notice info full-span">
                  Create an account or sign in to submit and track refund requests.
                </p>
              )}
              <label>
                Full Name
                <input
                  autoComplete="name"
                  defaultValue={profile?.full_name ?? ''}
                  name="fullName"
                  placeholder="Customer full name"
                  required
                />
              </label>
              <label>
                Email Address
                <input
                  autoComplete="email"
                  defaultValue={profile?.email ?? ''}
                  name="email"
                  placeholder="customer@example.com"
                  required
                  type="email"
                />
              </label>
              <label>
                Phone Number
                <input autoComplete="tel" name="phone" placeholder="Customer phone number" type="tel" />
              </label>
              <label>
                Refund Reference Number
                <input name="referenceNumber" placeholder="Refund reference" required />
              </label>
              <label>
                Order Number
                <input name="orderNumber" placeholder="Order number" required />
              </label>
              <label>
                Purchase Date
                <input name="purchaseDate" type="date" />
              </label>
              <label>
                Reason for Cancellation
                <select defaultValue="" name="refundReason" required>
                  <option disabled value="">
                    Select a reason
                  </option>
                  <option>Duplicate charge</option>
                  <option>Service cancellation</option>
                  <option>Product return</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Amount Requested
                <input
                  min="0"
                  name="amountRequested"
                  onChange={(event) => setRefundAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={refundAmount}
                />
              </label>
              <label>
                Preferred Refund Method
                <select defaultValue="" name="preferredPaymentMethod" required>
                  <option disabled value="">
                    Select a method
                  </option>
                  <option>Original payment method</option>
                  <option>Bank transfer</option>
                  <option>Store credit</option>
                </select>
              </label>
              <label>
                Upload Documents
                <input accept=".pdf,.jpg,.jpeg,.png" multiple name="documents" type="file" />
              </label>
              <div className="document-checklist">
                <span>Government ID</span>
                <span>Purchase Receipt</span>
                <span>Cancellation Proof</span>
              </div>
              <button
                className="primary-action"
                disabled={!supabase || !profile || isSubmittingRefund}
                type="submit"
              >
                {isSubmittingRefund ? 'Submitting...' : profile ? 'Submit refund request' : 'Sign in to submit'}
              </button>
            </form>

            <aside className="customer-panel-stack">
              <section className="work-card">
                <div className="section-heading customer-track-heading">
                  <div>
                    <p className="eyebrow">Customer tracking</p>
                    <h2>My refund requests</h2>
                  </div>
                  <span className="realtime-badge">Updates automatically</span>
                </div>
                {profile ? (
                  <div className="request-list">
                    {requests.map((request) => (
                      <article className="request-summary" key={request.id}>
                        <div className="request-identifiers">
                          <div>
                            <span>Reference number</span>
                            <strong>{request.reference_number}</strong>
                          </div>
                          <div>
                            <span>Order number</span>
                            <strong>{request.order_number}</strong>
                          </div>
                        </div>
                        <span className="status-pill">{formatStatus(request.status)}</span>
                        <dl>
                          <div>
                            <dt>Amount</dt>
                            <dd>${Number(request.amount_requested).toFixed(2)}</dd>
                          </div>
                          <div>
                            <dt>Method</dt>
                            <dd>{request.preferred_payment_method}</dd>
                          </div>
                          <div>
                            <dt>Submitted</dt>
                            <dd>{formatDate(request.created_at)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                    {requests.length === 0 && (
                      <p className="empty-state">No refund requests submitted yet.</p>
                    )}
                  </div>
                ) : (
                  <p className="empty-state">Your submitted refund requests will appear here.</p>
                )}
              </section>
            </aside>
          </section>
        )}

        {activeView === 'manager' && (
          <section>
            <div className="stats-grid">
              {managerStats.map(([label, value]) => (
                <article className="metric-card" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>

            <div className="content-grid">
              <section className="work-card">
                <div className="section-heading row-heading">
                  <div>
                    <p className="eyebrow">Refund manager dashboard</p>
                    <h2>Assigned requests</h2>
                  </div>
                  <input
                    className="search-input"
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search Customers"
                    value={searchTerm}
                  />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Customer</th>
                        <th>Order</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Owner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.map((request) => (
                        <tr
                          className={selectedRequest?.id === request.id ? 'selected-row' : ''}
                          key={request.id}
                          onClick={() => setSelectedRequestId(request.id)}
                        >
                          <td data-label="Request">{request.reference_number}</td>
                          <td data-label="Customer">{request.customers?.full_name ?? 'Unknown'}</td>
                          <td data-label="Order">{request.order_number}</td>
                          <td data-label="Amount">${Number(request.amount_requested).toFixed(2)}</td>
                          <td data-label="Status">
                            <span className="status-pill">{formatStatus(request.status)}</span>
                          </td>
                          <td data-label="Owner">
                            {request.assigned_to
                              ? (usersById.get(request.assigned_to)?.full_name ?? 'Assigned staff')
                              : 'Unassigned'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredRequests.length === 0 && (
                    <p className="empty-state">No refund requests found.</p>
                  )}
                </div>
                <div className="button-row">
                  <span className="realtime-badge">Live requests</span>
                  <button
                    disabled={
                      managerWorkflowActionStates.under_review.disabled ||
                      actionLoading === 'under_review'
                    }
                    onClick={() =>
                      void changeRequestStatus(
                        selectedRequest,
                        'under_review',
                        'Request opened for manager review.',
                      )
                    }
                    title={managerWorkflowActionStates.under_review.reason}
                    type="button"
                  >
                    Start review
                  </button>
                  <button
                    disabled={
                      managerWorkflowActionStates.documents_verified.disabled ||
                      actionLoading === 'documents_verified'
                    }
                    onClick={() =>
                      void changeRequestStatus(
                        selectedRequest,
                        'documents_verified',
                        'Supporting documents verified.',
                      )
                    }
                    title={managerWorkflowActionStates.documents_verified.reason}
                    type="button"
                  >
                    Verify documents
                  </button>
                  <button
                    disabled={
                      managerWorkflowActionStates.approved.disabled || actionLoading === 'approved'
                    }
                    onClick={() =>
                      void changeRequestStatus(selectedRequest, 'approved', 'Refund approved.')
                    }
                    title={managerWorkflowActionStates.approved.reason}
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    disabled={
                      !selectedRequest ||
                      ['approved', 'rejected', 'payment_processing', 'completed'].includes(
                        selectedRequest.status,
                      ) ||
                      actionLoading === 'rejected'
                    }
                    onClick={() =>
                      void changeRequestStatus(selectedRequest, 'rejected', 'Refund rejected.')
                    }
                    title={
                      selectedRequest &&
                      ['approved', 'rejected', 'payment_processing', 'completed'].includes(
                        selectedRequest.status,
                      )
                        ? `Request is already ${formatStatus(selectedRequest.status)}.`
                        : ''
                    }
                    type="button"
                  >
                    Reject
                  </button>
                  <button onClick={handleExportReports} type="button">
                    Export Reports
                  </button>
                </div>
              </section>

              <aside className="work-card">
                <div className="section-heading">
                  <p className="eyebrow">Notes & internal comments</p>
                  <h2>
                    {selectedRequest
                      ? `Reference number: ${selectedRequest.reference_number}`
                      : 'Activity timeline'}
                  </h2>
                </div>
                <textarea
                  onChange={(event) => setInternalNote(event.target.value)}
                  placeholder="Add internal comments for the selected request."
                  value={internalNote}
                />
                <button
                  className="secondary-action"
                  disabled={!selectedRequest || !internalNote.trim() || actionLoading === 'note'}
                  onClick={() => void handleSaveInternalNote()}
                  type="button"
                >
                  Save note
                </button>
                <div className="timeline-list">
                  {selectedTimeline.map((item) => (
                    <article key={item.id}>
                      <strong>{item.label}</strong>
                      <span>{formatDate(item.createdAt)}</span>
                      <p>{item.detail}</p>
                    </article>
                  ))}
                  {selectedTimeline.length === 0 && (
                    <p className="empty-state">No activity for the selected request yet.</p>
                  )}
                </div>
                <WorkflowCard compact />
              </aside>
            </div>
          </section>
        )}

        {activeView === 'admin' && (
          <section>
            <div className="stats-grid">
              {adminMetrics.map(([label, value]) => (
                <article className="metric-card" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>

            <div className="admin-layout">
              <section className="admin-main-stack">
                <section className="work-card">
                  <div className="section-heading row-heading">
                    <div>
                      <p className="eyebrow">Administrator dashboard</p>
                      <h2>User accounts</h2>
                    </div>
                    <span className="realtime-badge">Live accounts</span>
                  </div>
                  <div className="table-wrap">
                    <table className="user-accounts-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Status</th>
                          <th>Role</th>
                          <th>MFA</th>
                          <th>Created</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const verificationStatus = getVerificationStatus(user)
                          const deleteDisabled =
                            isHeadAdministrator(user.email) || user.id === profile?.id

                          return (
                            <tr key={user.id}>
                              <td data-label="Name">
                                <div className="user-name-cell">
                                  <span>{user.full_name}</span>
                                  {isHeadAdministrator(user.email) && (
                                    <span className="protected-badge">Head administrator</span>
                                  )}
                                </div>
                              </td>
                              <td data-label="Email">{user.email}</td>
                              <td data-label="Status">
                                <div className="status-cell">
                                  <span className={`verification-badge ${verificationStatus}`}>
                                    {verificationStatus === 'verified'
                                      ? 'Verified'
                                      : 'Pending verification'}
                                  </span>
                                  {verificationStatus === 'pending' && user.verification_expires_at && (
                                    <small>Expires {formatDate(user.verification_expires_at)}</small>
                                  )}
                                </div>
                              </td>
                              <td data-label="Role">
                                <select
                                  aria-label={`Role for ${user.full_name}`}
                                  disabled={isHeadAdministrator(user.email)}
                                  onChange={(event) =>
                                    void handleUpdateUserRole(user, event.target.value as UserRole)
                                  }
                                  value={user.role}
                                >
                                  <option value="customer">Customer</option>
                                  <option value="refund_manager">Refund manager</option>
                                  <option value="administrator">Administrator</option>
                                </select>
                              </td>
                              <td data-label="MFA">
                                <label className="inline-check">
                                  <input
                                    checked={user.mfa_required}
                                    disabled={isHeadAdministrator(user.email)}
                                    onChange={(event) =>
                                      void handleToggleMfa(user, event.target.checked)
                                    }
                                    type="checkbox"
                                  />
                                  Required
                                </label>
                              </td>
                              <td data-label="Created">{formatDate(user.created_at)}</td>
                              <td data-label="Action">
                                <button
                                  className="table-action-button danger"
                                  disabled={deleteDisabled}
                                  onClick={() => {
                                    setDeleteTargetUser(user)
                                    setDeleteConfirmationText('')
                                  }}
                                  title={
                                    deleteDisabled
                                      ? 'Protected or active-session account'
                                      : 'Delete this user account'
                                  }
                                  type="button"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {users.length === 0 && <p className="empty-state">No user accounts yet.</p>}
                  </div>
                </section>

                <section className="work-card">
                  <div className="section-heading row-heading">
                    <div>
                      <p className="eyebrow">Customer accounts</p>
                      <h2>Registered customers</h2>
                    </div>
                    <span className="realtime-badge">Live records</span>
                  </div>
                  <div className="table-wrap">
                    <table className="customer-accounts-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Status</th>
                          <th>Role</th>
                          <th>Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registeredCustomerAccounts.map((customer) => (
                          <tr key={customer.id}>
                            <td data-label="Name">{customer.full_name}</td>
                            <td data-label="Email">{customer.email}</td>
                            <td data-label="Status">
                              <span className={`verification-badge ${getVerificationStatus(customer)}`}>
                                {getVerificationStatus(customer) === 'verified'
                                  ? 'Verified'
                                  : 'Pending verification'}
                              </span>
                            </td>
                            <td data-label="Role">{customer.role.replace('_', ' ')}</td>
                            <td data-label="Joined">{formatDate(customer.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {registeredCustomerAccounts.length === 0 && (
                      <p className="empty-state">No registered customer accounts yet.</p>
                    )}
                  </div>
                </section>
              </section>

              <aside className="admin-side-stack">
                <section className="work-card">
                  <div className="section-heading">
                    <p className="eyebrow">Manager setup</p>
                    <h2>Add a refund manager</h2>
                  </div>
                  <ol className="setup-list">
                    <li>Create the person's account from the sign-up screen.</li>
                    <li>Return here and find the account under User accounts.</li>
                    <li>Change the role from Customer to Refund manager.</li>
                  </ol>
                  <p className="helper-copy">
                    The head administrator account is locked as the absolute portal owner.
                  </p>
                </section>

                <section className="work-card">
                  <div className="section-heading row-heading">
                    <div>
                      <p className="eyebrow">Immutable audit log</p>
                      <h2>Recent events</h2>
                    </div>
                    <span className="realtime-badge">Live audit</span>
                  </div>
                  <ol className="audit-list">
                    {auditEntries.map((event) => (
                      <li key={event.id}>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                        <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                  {auditLogs.length === 0 && <p className="empty-state">No audit events yet.</p>}
                </section>
              </aside>
            </div>
          </section>
        )}

        {activeView === 'bank' && (
          <section className="content-grid">
            <section className="work-card form-grid">
              <div className="section-heading full-span">
                <p className="eyebrow">Bank processing interface</p>
                <h2>Authorized payment request</h2>
              </div>
              <label className="full-span">
                Approved Refund
                <select
                  onChange={(event) => setSelectedRequestId(event.target.value)}
                  value={selectedPaymentRequest?.id ?? ''}
                >
                  <option disabled value="">
                    Select approved refund
                  </option>
                  {paymentReadyRequests.map((request) => (
                    <option key={request.id} value={request.id}>
                      {request.reference_number} - {request.customers?.full_name ?? 'Unknown'} - $
                      {Number(request.amount_requested).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Beneficiary Name
                <input
                  onChange={(event) => setBeneficiaryName(event.target.value)}
                  placeholder="Beneficiary name"
                  value={beneficiaryName}
                />
              </label>
              <label>
                Transaction Reference
                <input
                  onChange={(event) => setTransactionReference(event.target.value)}
                  placeholder="Auto-generated if blank"
                  value={transactionReference}
                />
              </label>
              <label>
                Payment Amount
                <input
                  readOnly
                  value={
                    selectedPaymentRequest
                      ? Number(selectedPaymentRequest.amount_requested).toFixed(2)
                      : ''
                  }
                />
              </label>
              <label>
                Payment Status
                <select
                  onChange={(event) => setPaymentStatus(event.target.value)}
                  value={paymentStatus}
                >
                  {bankStatuses.map((status) => (
                    <option key={status} value={status}>
                      {formatStatus(status)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="document-checklist full-span">
                <span>Verify beneficiary information</span>
                <span>Create authorized banking API request</span>
                <span>Track payment status</span>
                <span>Generate confirmation receipt</span>
                <span>Maintain transaction logs</span>
              </div>
              <button
                className="primary-action"
                disabled={
                  !selectedPaymentRequest || Boolean(selectedPaymentTransaction) || actionLoading === 'payment'
                }
                onClick={() => void handleCreatePayment()}
                type="button"
              >
                {selectedPaymentTransaction ? 'Payment request created' : 'Submit authorized payment request'}
              </button>
              <button
                className="secondary-action full-span"
                disabled={!selectedPaymentTransaction || actionLoading === 'payment-status'}
                onClick={() => void handleUpdatePaymentStatus()}
                type="button"
              >
                Update payment status
              </button>
            </section>

            <aside className="work-card">
              <div className="section-heading">
                <p className="eyebrow">Integration guardrails</p>
                <h2>Payment controls</h2>
              </div>
              <dl className="summary-list">
                <div>
                  <dt>Bank API</dt>
                  <dd>Configured by secrets manager</dd>
                </div>
                <div>
                  <dt>API credentials</dt>
                  <dd>Environment only</dd>
                </div>
                <div>
                  <dt>Estimated payment ETA</dt>
                  <dd>{paymentEta}</dd>
                </div>
                <div>
                  <dt>Current transaction</dt>
                  <dd>{selectedPaymentTransaction?.transaction_reference ?? 'Not created'}</dd>
                </div>
                <div>
                  <dt>Retry policy</dt>
                  <dd>Logged with backoff</dd>
                </div>
              </dl>
              <label className="toggle-row">
                <input
                  checked={otpEnabled}
                  onChange={(event) => setOtpEnabled(event.target.checked)}
                  type="checkbox"
                />
                Require manager OTP before payout
              </label>
              <div className="timeline-list">
                {paymentTransactions.map((transaction) => (
                  <article key={transaction.id}>
                    <strong>{transaction.transaction_reference}</strong>
                    <span>{formatStatus(transaction.status)}</span>
                    <p>${Number(transaction.amount).toFixed(2)} via {transaction.provider}</p>
                  </article>
                ))}
                {paymentTransactions.length === 0 && (
                  <p className="empty-state">No payment transactions yet.</p>
                )}
              </div>
            </aside>
          </section>
        )}
      </section>

      {customerDialog && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="customer-dialog-title"
            aria-modal="true"
            className={`customer-dialog ${customerDialog.kind}`}
            role="dialog"
          >
            <div>
              <p className="eyebrow">
                {customerDialog.kind === 'success' ? 'Request update' : 'Action needed'}
              </p>
              <h2 id="customer-dialog-title">
                {customerDialog.kind === 'success'
                  ? 'Refund request received'
                  : 'Please review your request'}
              </h2>
            </div>
            <p>{customerDialog.message}</p>
            <button onClick={() => setCustomerDialog(null)} type="button">
              Close
            </button>
          </section>
        </div>
      )}

      {deleteTargetUser && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="delete-user-dialog-title"
            aria-modal="true"
            className="customer-dialog danger"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Administrator action</p>
              <h2 id="delete-user-dialog-title">Delete user account</h2>
            </div>
            <p>
              This permanently removes {deleteTargetUser.email} and related portal records. Type{' '}
              <strong>Delete user account</strong> to confirm.
            </p>
            <input
              aria-label="Delete confirmation text"
              className="delete-confirm-input"
              onChange={(event) => setDeleteConfirmationText(event.target.value)}
              placeholder="Delete user account"
              value={deleteConfirmationText}
            />
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setDeleteTargetUser(null)
                  setDeleteConfirmationText('')
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={
                  isDeletingUser || deleteConfirmationText !== 'Delete user account'
                }
                onClick={() => void handleDeleteUserAccount()}
                type="button"
              >
                {isDeletingUser ? 'Deleting...' : 'Delete account'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function WorkflowCard({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`work-card workflow-card ${compact ? 'compact' : ''}`}>
      <div className="section-heading">
        <p className="eyebrow">Refund workflow</p>
        <h2>Status flow</h2>
      </div>
      <div className="workflow-list">
        {workflow.map((step, index) => (
          <div key={step}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
    </aside>
  )
}

function getAllowedViews(role?: UserRole): PortalView[] {
  if (role === 'administrator') return ['manager', 'admin', 'bank']
  if (role === 'refund_manager') return ['manager', 'bank']
  return ['customer']
}

function getManagerWorkflowActionState(
  request: RefundRequestRow | null,
  history: StatusHistoryRow[],
  target: ManagerWorkflowTarget,
) {
  if (!request) {
    return { disabled: true, reason: 'Select a refund request first.' }
  }

  const currentStatus = request.status as RefundStatus
  const terminalStatuses: RefundStatus[] = ['rejected', 'payment_processing', 'completed']

  if (terminalStatuses.includes(currentStatus)) {
    return {
      disabled: true,
      reason: `Request is already ${formatStatus(currentStatus)}.`,
    }
  }

  if (history.some((item) => item.to_status === target)) {
    return {
      disabled: true,
      reason: `${formatStatus(target)} has already been recorded.`,
    }
  }

  const currentRank = requestStatusRank[currentStatus]
  const targetRank = managerWorkflowActionRank[target]

  if (currentRank !== undefined && currentRank >= targetRank) {
    return {
      disabled: true,
      reason: `${formatStatus(target)} is locked because this request has already reached ${formatStatus(
        currentStatus,
      )}.`,
    }
  }

  return { disabled: false, reason: '' }
}

function isManagerWorkflowTarget(status: RefundStatus): status is ManagerWorkflowTarget {
  return status === 'under_review' || status === 'documents_verified' || status === 'approved'
}

function isHeadAdministrator(email: string) {
  return email.trim().toLowerCase() === headAdministratorEmail
}

function getVerificationStatus(user: UserAccountRow) {
  if (isHeadAdministrator(user.email)) return 'verified'

  return user.email_confirmed_at || user.verification_status === 'verified' ? 'verified' : 'pending'
}

function formatAuditEntry(event: AuditLogRow, usersById: Map<string, UserAccountRow>) {
  const actor = getAuditActor(event, usersById)
  const metadata = event.metadata ?? {}
  const target = getAuditTarget(event, usersById)
  const reference = readMetadataString(metadata, 'referenceNumber')
  const transaction = readMetadataString(metadata, 'transactionReference')
  const from = readMetadataString(metadata, 'from')
  const to = readMetadataString(metadata, 'to')

  let detail = `${actor} performed this action.`

  if (event.action === 'user_role_updated') {
    detail = `${actor} changed ${target}'s role from ${formatAuditValue(from)} to ${formatAuditValue(to)}.`
  } else if (event.action === 'user_mfa_updated') {
    detail = `${actor} changed ${target}'s MFA requirement from ${formatAuditValue(from)} to ${formatAuditValue(to)}.`
  } else if (event.action === 'user_account_deleted') {
    detail = `${actor} deleted ${target} from the portal.`
  } else if (event.action === 'refund_status_changed') {
    detail = `${actor} moved refund ${reference || event.entity_id || 'request'} from ${formatAuditValue(
      from,
    )} to ${formatAuditValue(to)}.`
  } else if (event.action === 'payment_status_updated') {
    detail = `${actor} updated payment ${transaction || event.entity_id || 'transaction'} from ${formatAuditValue(
      from,
    )} to ${formatAuditValue(to)}.`
  } else if (event.action === 'refund_report_exported') {
    detail = `${actor} exported ${readMetadataString(metadata, 'count') || '0'} refund records.`
  } else if (event.action === 'internal_note_added') {
    detail = `${actor} added an internal note to refund ${reference || event.entity_id || 'request'}.`
  } else if (event.action === 'refund_submitted') {
    detail = `${actor} submitted refund ${reference || event.entity_id || 'request'}.`
  }

  return {
    createdAt: event.created_at,
    detail,
    id: event.id,
    title: titleCase(event.action.replaceAll('_', ' ')),
  }
}

function getAuditActor(event: AuditLogRow, usersById: Map<string, UserAccountRow>) {
  if (event.actor_id && usersById.has(event.actor_id)) {
    return getUserDisplayName(usersById.get(event.actor_id))
  }

  const actorName = readMetadataString(event.metadata, 'actorName')
  const actorEmail = readMetadataString(event.metadata, 'actorEmail')

  return actorName || actorEmail || 'System'
}

function getAuditTarget(event: AuditLogRow, usersById: Map<string, UserAccountRow>) {
  if (event.entity_id && event.entity_type === 'user' && usersById.has(event.entity_id)) {
    return getUserDisplayName(usersById.get(event.entity_id))
  }

  return (
    readMetadataString(event.metadata, 'targetName') ||
    readMetadataString(event.metadata, 'targetEmail') ||
    readMetadataString(event.metadata, 'email') ||
    event.entity_id ||
    'the selected record'
  )
}

function getUserDisplayName(user: UserAccountRow | undefined) {
  if (!user) return 'Unknown user'

  return user.full_name ? `${user.full_name} (${user.email})` : user.email
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]

  if (value === null || value === undefined) return ''

  return String(value)
}

function formatAuditValue(value: string) {
  return value ? formatStatus(value) : 'Unrecorded'
}

function titleCase(value: string) {
  return value
    .split(' ')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function getCustomerFriendlyError(message: string) {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('refund_requests_reference_number_key') ||
    normalized.includes('duplicate key')
  ) {
    return 'A refund request with this reference number already exists. Please check My refund requests or use the correct reference from your receipt.'
  }

  if (normalized.includes('row-level security')) {
    return 'Your account does not have permission to complete this action. Please sign out and sign in again, then try once more.'
  }

  if (normalized.includes('network')) {
    return 'We could not reach the refund system. Please check your connection and try again.'
  }

  return 'We could not complete your request right now. Please review the information and try again.'
}

async function createBeneficiaryHash(value: string) {
  const data = new TextEncoder().encode(value.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', data)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function getPasswordResetRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?password-reset=1`
}

function isRecoveryUrl() {
  const recoveryUrl = `${window.location.search}${window.location.hash}`

  return recoveryUrl.includes('password-reset=1') || recoveryUrl.includes('type=recovery')
}

function clearRecoveryUrl() {
  window.history.replaceState(null, '', window.location.pathname)
}

export default App
