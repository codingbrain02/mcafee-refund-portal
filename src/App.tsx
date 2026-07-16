import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AuditLogRow,
  hasSupabaseConfig,
  type InternalNoteRow,
  type NotificationRow,
  type PaymentTransactionRow,
  type RefundDocumentRow,
  supabase,
  type RefundRequestRow,
  type StatusHistoryRow,
  type UserAccountRow,
  type UserProfile,
  type UserRole,
} from './lib/supabase'
import './App.css'

type PortalView = 'customer' | 'manager' | 'admin' | 'bank'
type NoticeKind = 'info' | 'success' | 'error'
type RefundStatus =
  | 'submitted'
  | 'under_review'
  | 'documents_verified'
  | 'approved'
  | 'rejected'
  | 'payment_processing'
  | 'completed'
  | 'credited'

type Notice = {
  kind: NoticeKind
  message: string
  title?: string
}

type AuthMode = 'sign-in' | 'sign-up'
type AuthDialog = 'confirm-sign-out' | null

type ManagerWorkflowTarget = 'under_review' | 'documents_verified' | 'approved'
type ReportFormat = 'csv' | 'pdf'

type AntivirusOption = {
  accent: string
  icon: string
  label: string
  logo: string
  status: string
  statusBg: string
}

const workflow = [
  'Pending Review',
  'Documents Verified',
  'Approval',
  'Processing',
  'Credited',
]

const bankStatuses = ['queued', 'submitted', 'settled', 'failed']
const reportStatuses: RefundStatus[] = [
  'submitted',
  'under_review',
  'documents_verified',
  'approved',
  'rejected',
  'payment_processing',
  'credited',
  'completed',
]
const headAdministratorEmail = 'jccodingbrain@gmail.com'
const antivirusOptions: AntivirusOption[] = [
  {
    accent: '#b91c1c',
    icon: '/mcafee-icon.png',
    label: 'McAfee',
    logo: '/mcafee-logo.png',
    status: '#9a3412',
    statusBg: '#fff2df',
  },
  {
    accent: '#f7b500',
    icon: '/norton-icon.png',
    label: 'Norton',
    logo: '/norton-logo.png',
    status: '#7c5800',
    statusBg: '#fff7d6',
  },
  {
    accent: '#f97316',
    icon: '/avast-icon.png',
    label: 'Avast',
    logo: '/avast-logo.png',
    status: '#9a3412',
    statusBg: '#ffedd5',
  },
  {
    accent: '#1646d8',
    icon: '/malwarebytes-icon.png',
    label: 'Malwarebytes',
    logo: '/malwarebytes-logo.png',
    status: '#1d4ed8',
    statusBg: '#eff6ff',
  },
  {
    accent: '#0f766e',
    icon: '/totalav-icon.png',
    label: 'TotalAV',
    logo: '/totalav-logo.png',
    status: '#0f766e',
    statusBg: '#ccfbf1',
  },
  {
    accent: '#334155',
    icon: '/others-icon.png',
    label: 'Other antivirus',
    logo: '/others-icon.png',
    status: '#475569',
    statusBg: '#f1f5f9',
  },
]

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
  credited: 5,
  completed: 5,
}

const viewLabels: Record<PortalView, string> = {
  customer: 'customer',
  manager: 'manager',
  admin: 'admin',
  bank: 'bank',
}

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const [view, setView] = useState<PortalView>('customer')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [signupFullName, setSignupFullName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [newAccountFullName, setNewAccountFullName] = useState('')
  const [newAccountEmail, setNewAccountEmail] = useState('')
  const [newAccountPassword, setNewAccountPassword] = useState('')
  const [newAccountRole, setNewAccountRole] = useState<UserRole>('customer')
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [customerDialog, setCustomerDialog] = useState<Notice | null>(null)
  const [authDialog, setAuthDialog] = useState<AuthDialog>(null)
  const [deleteTargetUser, setDeleteTargetUser] = useState<UserAccountRow | null>(null)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [deleteUserError, setDeleteUserError] = useState('')
  const [isDeletingUser, setIsDeletingUser] = useState(false)
  const [cancelTargetRequest, setCancelTargetRequest] = useState<RefundRequestRow | null>(null)
  const [cancelConfirmationText, setCancelConfirmationText] = useState('')
  const [isCancellingRefund, setIsCancellingRefund] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSessionRestoring, setIsSessionRestoring] = useState(hasSupabaseConfig)
  const [notice, setNotice] = useState<Notice>({
    kind: hasSupabaseConfig ? 'info' : 'error',
    message: hasSupabaseConfig
      ? 'Use your authorized account to access the refund portal.'
      : 'Portal configuration is incomplete.',
  })
  const [isAuthLoading, setIsAuthLoading] = useState(false)
  const [isResetLoading, setIsResetLoading] = useState(false)
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false)
  const [isSubmittingStaffRefund, setIsSubmittingStaffRefund] = useState(false)
  const [staffRefundAmount, setStaffRefundAmount] = useState('')
  const [selectedAntivirus, setSelectedAntivirus] = useState('McAfee')
  const [staffIntakeProduct, setStaffIntakeProduct] = useState('McAfee')
  const [requests, setRequests] = useState<RefundRequestRow[]>([])
  const [users, setUsers] = useState<UserAccountRow[]>([])
  const [statusHistory, setStatusHistory] = useState<StatusHistoryRow[]>([])
  const [internalNotes, setInternalNotes] = useState<InternalNoteRow[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([])
  const [paymentTransactions, setPaymentTransactions] = useState<PaymentTransactionRow[]>([])
  const [refundDocuments, setRefundDocuments] = useState<RefundDocumentRow[]>([])
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [customerOrderLookup, setCustomerOrderLookup] = useState('')
  const [customerAntivirus, setCustomerAntivirus] = useState('McAfee')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerPurchaseDate, setCustomerPurchaseDate] = useState('')
  const [customerRequestedAmount, setCustomerRequestedAmount] = useState('')
  const [customerPreferredMethod, setCustomerPreferredMethod] = useState('')
  const [customerRefundReason, setCustomerRefundReason] = useState('')
  const [customerRefundDetails, setCustomerRefundDetails] = useState('')
  const [customerDocuments, setCustomerDocuments] = useState<File[]>([])
  const [mfaFactorId, setMfaFactorId] = useState('')
  const [mfaChallengeId, setMfaChallengeId] = useState('')
  const mfaChallengeIdRef = useRef('')
  const [mfaCode, setMfaCode] = useState('')
  const [securityDialogOpen, setSecurityDialogOpen] = useState(false)
  const [mfaEnrollmentId, setMfaEnrollmentId] = useState('')
  const [mfaEnrollmentQr, setMfaEnrollmentQr] = useState('')
  const [mfaEnrollmentSecret, setMfaEnrollmentSecret] = useState('')
  const [mfaEnrollmentCode, setMfaEnrollmentCode] = useState('')
  const [hasVerifiedMfa, setHasVerifiedMfa] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [reportStatusFilter, setReportStatusFilter] = useState('all')
  const [reportProductFilter, setReportProductFilter] = useState('all')
  const [reportFormat, setReportFormat] = useState<ReportFormat>('csv')
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [beneficiaryLast4, setBeneficiaryLast4] = useState('')
  const [transactionReference, setTransactionReference] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('submitted')
  const [actionLoading, setActionLoading] = useState('')
  const [documentLoadingId, setDocumentLoadingId] = useState('')

  const allowedViews = useMemo(() => getAllowedViews(profile?.role), [profile])
  const activeView = allowedViews.includes(view) ? view : allowedViews[0]

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!['/', '/login'].includes(currentPath) || isPasswordRecovery) return
    const nextPath = profile ? '/' : '/login'
    if (currentPath === nextPath) return
    window.history.replaceState({}, '', nextPath)
  }, [currentPath, isPasswordRecovery, profile])

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
    // The Supabase auth listener is intentionally registered once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (profile) {
      void loadRefundRequests()
      void loadStatusHistory()
      void loadRefundDocuments()
    }
  }, [profile])

  useEffect(() => {
    if (profile?.role === 'administrator' || profile?.role === 'refund_manager') {
      void loadInternalNotes()
      void loadPaymentTransactions()
      void loadNotifications()
      void loadUsers(profile.email)
    }

    if (profile?.role === 'administrator') {
      void loadAuditLogs()
    }
  }, [profile?.email, profile?.role])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_documents' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_notes' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, queueRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, queueRealtimeRefresh)
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

  const searchedRequests = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return requests.filter(
      (request) =>
        !query ||
        [
          request.reference_number,
          request.order_number,
          request.product_name,
          request.status,
          request.customers?.full_name,
          request.customers?.email,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
    )
  }, [requests, searchTerm])

  const filteredRequests = useMemo(
    () =>
      searchedRequests.filter(
        (request) =>
          (reportStatusFilter === 'all' || request.status === reportStatusFilter) &&
          (reportProductFilter === 'all' || request.product_name === reportProductFilter),
      ),
    [reportProductFilter, reportStatusFilter, searchedRequests],
  )

  const reportSummary = useMemo(() => {
    const totalAmount = filteredRequests.reduce(
      (total, request) => total + Number(request.amount_requested),
      0,
    )
    const credited = filteredRequests.filter((request) =>
      ['credited', 'completed'].includes(request.status),
    ).length

    return {
      count: filteredRequests.length,
      credited,
      totalAmount,
      averageAmount: filteredRequests.length ? totalAmount / filteredRequests.length : 0,
    }
  }, [filteredRequests])

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? requests[0] ?? null,
    [requests, selectedRequestId],
  )

  const activeAntivirus = useMemo(() => {
    const productName =
      activeView === 'customer'
        ? selectedAntivirus
        : selectedRequest?.product_name || selectedAntivirus

    return getAntivirusOption(productName)
  }, [activeView, selectedAntivirus, selectedRequest?.product_name])
  const staffIntakeAntivirus = useMemo(
    () => getAntivirusOption(staffIntakeProduct),
    [staffIntakeProduct],
  )

  const portalTheme = useMemo(
    () =>
      ({
        '--accent': '#075b68',
        '--status': activeAntivirus.status,
        '--status-bg': activeAntivirus.statusBg,
      }) as CSSProperties,
    [activeAntivirus],
  )

  useEffect(() => {
    document.title = `${activeAntivirus.label} Refund Processing Portal`

    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

    if (favicon) {
      favicon.href = activeAntivirus.icon
      favicon.type = activeAntivirus.icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
    }
  }, [activeAntivirus])

  const paymentReadyRequests = useMemo(
    () =>
      requests.filter((request) =>
        ['approved', 'payment_processing', 'credited', 'completed'].includes(request.status),
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

  const managerWorkflowActionStates = useMemo(() => {
    const orderVerificationPending = Boolean(
      selectedRequest &&
        (Number(selectedRequest.amount_requested) <= 0 ||
          !selectedRequest.purchase_date ||
          selectedRequest.preferred_payment_method === 'Pending staff verification'),
    )
    const underReview = getManagerWorkflowActionState(
      selectedRequest,
      selectedStatusHistory,
      'under_review',
    )

    return {
      under_review: orderVerificationPending
        ? { disabled: true, reason: 'Verify the order amount and payment method before starting review.' }
        : underReview,
      documents_verified: getManagerWorkflowActionState(
        selectedRequest,
        selectedStatusHistory,
        'documents_verified',
      ),
      approved: getManagerWorkflowActionState(selectedRequest, selectedStatusHistory, 'approved'),
    }
  },
    [selectedRequest, selectedStatusHistory],
  )

  const documentsAlreadyRequested = useMemo(
    () =>
      Boolean(
        selectedRequest &&
          notifications.some(
            (notification) =>
              notification.refund_request_id === selectedRequest.id &&
              notification.template === 'documents_requested',
          ),
      ),
    [notifications, selectedRequest],
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
    () =>
      auditLogs
        .filter((event) => event.action !== 'user_mfa_updated')
        .map((event) => formatAuditEntry(event, usersById)),
    [auditLogs, usersById],
  )

  const visibleAuditEntries = useMemo(() => auditEntries.slice(0, 8), [auditEntries])
  const canManageUserAccounts = isHeadAdministrator(profile?.email ?? '')
  const customerPanelRequests = profile?.role === 'administrator' ? searchedRequests : requests

  const paymentEta = useMemo(() => {
    const amount = Number(selectedPaymentRequest?.amount_requested) || 0
    if (!amount) return 'Awaiting amount'
    return amount > 1000 ? 'Manual bank review required' : '2 business days'
  }, [selectedPaymentRequest?.amount_requested])

  async function loadProfile(userId: string | null) {
    if (!supabase || !userId) {
      setProfile(null)
      setRequests([])
      setUsers([])
      setStatusHistory([])
      setInternalNotes([])
      setAuditLogs([])
      setPaymentTransactions([])
      setNotifications([])
      setSelectedRequestId('')
      return
    }

    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (assurance?.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const factor = factors?.totp.find((candidate) => candidate.status === 'verified')
      if (factor && !mfaChallengeIdRef.current) {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: factor.id,
        })
        if (challengeError || !challenge?.id) {
          setNotice({ kind: 'error', message: 'Two-factor verification could not be started.' })
          return
        }
        setMfaFactorId(factor.id)
        setMfaChallengeId(challenge.id)
        mfaChallengeIdRef.current = challenge.id
      }
      setProfile(null)
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
      await loadInitialPortalData(fallbackProfile)
      return
    }

    const loadedProfile = data as UserProfile
    setProfile(loadedProfile)
    await loadInitialPortalData(loadedProfile)
  }

  async function loadInitialPortalData(profileToLoad: UserProfile) {
    await Promise.all([loadRefundRequests(), loadStatusHistory(), loadRefundDocuments()])

    if (profileToLoad.role === 'administrator' || profileToLoad.role === 'refund_manager') {
      await dispatchQueuedNotifications()
      await Promise.all([
        loadInternalNotes(),
        loadPaymentTransactions(),
        loadNotifications(),
        loadUsers(profileToLoad.email),
      ])
    }

    if (profileToLoad.role === 'administrator') {
      await loadAuditLogs()
    }
  }

  async function loadRefundRequests() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('refund_requests')
      .select(
        'id, reference_number, order_number, product_name, purchase_date, amount_requested, customer_phone_submitted, customer_purchase_date, customer_requested_amount, customer_preferred_payment_method, refund_reason, preferred_payment_method, status, assigned_to, created_at, customers(full_name, email, phone)',
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

  async function loadUsers(viewerEmail: string) {
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

    const canSeeHeadAdministrator = isHeadAdministrator(viewerEmail)
    setUsers(
      ((data ?? []) as UserAccountRow[]).filter(
        (user) => canSeeHeadAdministrator || !isHeadAdministrator(user.email),
      ),
    )
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

  async function loadRefundDocuments() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('refund_documents')
      .select('id, refund_request_id, document_type, storage_path, mime_type, file_size_bytes, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setRefundDocuments((data ?? []) as RefundDocumentRow[])
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
        'id, refund_request_id, provider, transaction_reference, beneficiary_hash, beneficiary_last4, amount, status, error_message, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setPaymentTransactions((data ?? []) as PaymentTransactionRow[])
  }

  async function loadNotifications() {
    if (!supabase) return

    const { data, error } = await supabase
      .from('notifications')
      .select(
        'id, refund_request_id, channel, recipient, template, status, subject, provider, provider_message_id, attempt_count, max_attempts, next_attempt_at, last_attempt_at, last_error, credited_at, account_last4, created_at, sent_at',
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      setNotice({ kind: 'error', message: error.message })
      return
    }

    setNotifications((data ?? []) as NotificationRow[])
  }

  async function dispatchQueuedNotifications(refundRequestId?: string) {
    if (!supabase) return false

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) return false

    try {
      const response = await fetch('/api/process-notifications', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refundRequestId }),
      })

      return response.ok
    } catch {
      return false
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setIsAuthLoading(true)
    setIsSessionRestoring(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    })

    if (error) {
      setIsAuthLoading(false)
      setIsSessionRestoring(false)
      setNotice({ kind: 'error', message: error.message })
      return
    }

    if (data.user?.id) await loadProfile(data.user.id)

    setAuthPassword('')
    setIsAuthLoading(false)
    setIsSessionRestoring(false)
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const fullName = signupFullName.trim()
    const email = authEmail.trim().toLowerCase()

    if (!fullName || !email || authPassword.length < 8) {
      setNotice({ kind: 'error', message: 'Enter your full name, email, and a password of at least 8 characters.' })
      return
    }

    setIsAuthLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password: authPassword,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })
    setIsAuthLoading(false)

    if (error) {
      setNotice({ kind: 'error', message: getCustomerFriendlyError(error.message) })
      return
    }

    if (data.session) await supabase.auth.signOut()

    setSignupFullName('')
    setAuthEmail('')
    setAuthPassword('')
    setAuthMode('sign-in')
    setNotice({ kind: 'info', message: 'Use your verified customer account to access the refund portal.' })
    showCustomerDialog(
      'success',
      'Open the verification message sent to your email address. After verification, return here and sign in.',
      'Check your email',
    )
  }

  async function handleVerifySignInMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !mfaFactorId || !mfaChallengeId || mfaCode.length !== 6) return

    setIsAuthLoading(true)
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    })

    if (error) {
      setIsAuthLoading(false)
      setNotice({ kind: 'error', message: 'The authenticator code was not accepted.' })
      return
    }

    const { data: userData } = await supabase.auth.getUser()
    setMfaCode('')
    setMfaFactorId('')
    setMfaChallengeId('')
    mfaChallengeIdRef.current = ''
    if (userData.user?.id) await loadProfile(userData.user.id)
    setIsAuthLoading(false)
  }

  async function handleCancelMfaSignIn() {
    if (supabase) await supabase.auth.signOut()
    setMfaCode('')
    setMfaFactorId('')
    setMfaChallengeId('')
    mfaChallengeIdRef.current = ''
    setNotice({ kind: 'info', message: 'Sign in to access the refund portal.' })
  }

  async function handleCreateUserAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !profile || profile.role !== 'administrator') return

    const fullName = newAccountFullName.trim()
    const email = newAccountEmail.trim().toLowerCase()

    if (!fullName || !email || newAccountPassword.length < 8) {
      showCustomerDialog('error', 'Enter a full name, valid email, and an 8-character temporary password.')
      return
    }

    if (newAccountRole === 'administrator' && !isHeadAdministrator(profile.email)) {
      showCustomerDialog('error', 'Contact the portal administrator to create an Administrator account.')
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      showCustomerDialog('error', 'Your session expired. Sign in again to create an account.')
      return
    }

    setIsCreatingAccount(true)

    try {
      const response = await fetch('/api/create-user', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          fullName,
          password: newAccountPassword,
          role: newAccountRole,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }

      if (!response.ok) {
        throw new Error(result.error || 'The account could not be created.')
      }

      setNewAccountFullName('')
      setNewAccountEmail('')
      setNewAccountPassword('')
      setNewAccountRole('customer')
      await loadUsers(profile.email)
      await loadAuditLogs()
      showCustomerDialog(
        'success',
        result.message ?? `A verification email was sent to ${email}.`,
        'Account created',
      )
    } catch (error) {
      showCustomerDialog(
        'error',
        error instanceof Error ? error.message : 'The account could not be created.',
        'Account creation failed',
      )
    } finally {
      setIsCreatingAccount(false)
    }
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

  async function handleOpenSecurityDialog() {
    if (!supabase) return
    const { data } = await supabase.auth.mfa.listFactors()
    setHasVerifiedMfa(Boolean(data?.totp.some((factor) => factor.status === 'verified')))
    setMfaEnrollmentId('')
    setMfaEnrollmentQr('')
    setMfaEnrollmentSecret('')
    setMfaEnrollmentCode('')
    setSecurityDialogOpen(true)
  }

  async function handleBeginMfaEnrollment() {
    if (!supabase) return
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Refund Portal Authenticator',
    })

    if (error || !data?.id || !data.totp) {
      showCustomerDialog('error', 'Two-factor setup could not be started.')
      return
    }

    setMfaEnrollmentId(data.id)
    setMfaEnrollmentQr(data.totp.qr_code)
    setMfaEnrollmentSecret(data.totp.secret)
  }

  async function handleVerifyMfaEnrollment() {
    if (!supabase || !mfaEnrollmentId || mfaEnrollmentCode.length !== 6) return
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: mfaEnrollmentId,
    })

    if (challengeError || !challenge?.id) {
      showCustomerDialog('error', 'The authenticator verification could not be started.')
      return
    }

    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaEnrollmentId,
      challengeId: challenge.id,
      code: mfaEnrollmentCode,
    })

    if (error) {
      showCustomerDialog('error', 'The authenticator code was not accepted.')
      return
    }

    setHasVerifiedMfa(true)
    setMfaEnrollmentId('')
    setMfaEnrollmentQr('')
    setMfaEnrollmentSecret('')
    setMfaEnrollmentCode('')
    await logAudit('user_mfa_enabled', 'user', profile?.id ?? null, {})
  }

  async function handleDisableMfa() {
    if (!supabase) return
    const { data } = await supabase.auth.mfa.listFactors()
    const verifiedFactors = data?.totp.filter((factor) => factor.status === 'verified') ?? []

    for (const factor of verifiedFactors) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (error) {
        showCustomerDialog('error', 'Two-factor authentication could not be disabled.')
        return
      }
    }

    setHasVerifiedMfa(false)
    await logAudit('user_mfa_disabled', 'user', profile?.id ?? null, {})
  }

  async function handleSignOut() {
    if (!supabase) return
    setIsSigningOut(true)
    await supabase.auth.signOut()
    setProfile(null)
    setRequests([])
    setUsers([])
    setStatusHistory([])
    setInternalNotes([])
    setAuditLogs([])
    setPaymentTransactions([])
    setRefundDocuments([])
    setNotifications([])
    setCustomerOrderLookup('')
    setCustomerAntivirus('McAfee')
    setCustomerPhone('')
    setCustomerPurchaseDate('')
    setCustomerRequestedAmount('')
    setCustomerPreferredMethod('')
    setCustomerRefundReason('')
    setCustomerRefundDetails('')
    setCustomerDocuments([])
    setMfaFactorId('')
    setMfaChallengeId('')
    setMfaCode('')
    mfaChallengeIdRef.current = ''
    setSelectedRequestId('')
    setView('customer')
    setAuthDialog(null)
    setIsSigningOut(false)
    setNotice({ kind: 'info', message: 'Use your authorized account to access the refund portal.' })
  }

  async function handleRefundSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !profile) return

    if (
      !customerOrderLookup.trim() ||
      !customerAntivirus ||
      !customerPhone.trim() ||
      !customerPurchaseDate ||
      Number(customerRequestedAmount) <= 0 ||
      !customerPreferredMethod ||
      !customerRefundReason
    ) {
      showCustomerDialog('error', 'Complete all required refund fields before submitting.')
      return
    }

    if (!customerRefundReason) {
      showCustomerDialog('error', 'Select a refund reason before submitting.')
      return
    }

    const invalidFile = customerDocuments.find(
      (file) =>
        !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ||
        file.size === 0 ||
        file.size > 10 * 1024 * 1024,
    )

    if (invalidFile) {
      showCustomerDialog(
        'error',
        `${invalidFile.name} must be a non-empty PDF, JPG, or PNG file below 10 MB.`,
      )
      return
    }

    setIsSubmittingRefund(true)
    const { data, error } = await supabase.rpc('submit_customer_refund_request_details', {
      p_customer_phone: customerPhone.trim(),
      p_order_number: customerOrderLookup.trim(),
      p_preferred_payment_method: customerPreferredMethod,
      p_product_name: customerAntivirus,
      p_purchase_date: customerPurchaseDate,
      p_requested_amount: Number(customerRequestedAmount),
      p_refund_reason: customerRefundDetails.trim()
        ? `${customerRefundReason}: ${customerRefundDetails.trim()}`
        : customerRefundReason,
    })
    const result = Array.isArray(data) ? data[0] : data

    if (error || !result?.refund_request_id) {
      setIsSubmittingRefund(false)
      showCustomerDialog(
        'error',
        getCustomerFriendlyError(error?.message ?? 'The refund request could not be submitted.'),
      )
      return
    }

    for (const file of customerDocuments) {
      const storagePath = `${result.refund_request_id}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('refund-documents')
        .upload(storagePath, file)

      if (uploadError) {
        showCustomerDialog('error', getCustomerFriendlyError(uploadError.message))
        continue
      }

      const { error: documentError } = await supabase.from('refund_documents').insert({
        refund_request_id: result.refund_request_id,
        document_type: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        file_size_bytes: file.size,
        uploaded_by: profile.id,
      })

      if (documentError) {
        showCustomerDialog('error', getCustomerFriendlyError(documentError.message))
      }
    }

    const notificationDispatched = await dispatchQueuedNotifications(result.refund_request_id)
    setIsSubmittingRefund(false)
    setCustomerOrderLookup('')
    setCustomerAntivirus('McAfee')
    setCustomerPhone('')
    setCustomerPurchaseDate('')
    setCustomerRequestedAmount('')
    setCustomerPreferredMethod('')
    setCustomerRefundReason('')
    setCustomerRefundDetails('')
    setCustomerDocuments([])
    await refreshOperations()
    showCustomerDialog(
      notificationDispatched ? 'success' : 'info',
      notificationDispatched
        ? `Refund request ${result.reference_number} was submitted. A confirmation email is on its way.`
        : `Refund request ${result.reference_number} was submitted. The confirmation email remains queued.`,
      'Refund request submitted',
    )
  }

  function handleCustomerFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files)
    const validFiles = nextFiles.filter(
      (file) =>
        ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) &&
        file.size > 0 &&
        file.size <= 10 * 1024 * 1024,
    )

    if (validFiles.length !== nextFiles.length) {
      showCustomerDialog('error', 'Only non-empty PDF, JPG, and PNG files below 10 MB can be attached.')
    }

    setCustomerDocuments((current) => {
      const combined = [...current, ...validFiles]
      return combined.filter(
        (file, index) =>
          combined.findIndex(
            (candidate) =>
              candidate.name === file.name &&
              candidate.size === file.size &&
              candidate.lastModified === file.lastModified,
          ) === index,
      )
    })
  }

  async function handleVerifyCustomerOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedRequest) return

    const form = new FormData(event.currentTarget)
    const purchaseDate = String(form.get('purchaseDate') ?? '')
    const refundAmount = Number(form.get('refundAmount'))
    const refundMethod = String(form.get('refundMethod') ?? '').trim()

    setActionLoading('verify-order')
    const { error } = await supabase.rpc('verify_customer_refund_order', {
      p_refund_request_id: selectedRequest.id,
      p_purchase_date: purchaseDate,
      p_refund_amount: refundAmount,
      p_refund_method: refundMethod,
    })
    setActionLoading('')

    if (error) {
      showCustomerDialog('error', getCustomerFriendlyError(error.message), 'Order verification failed')
      return
    }

    await refreshOperations()
    showCustomerDialog(
      'success',
      `The verified amount and payment method were recorded for ${selectedRequest.reference_number}.`,
      'Order details verified',
    )
  }

  async function handleDownloadReceipt(request: RefundRequestRow) {
    const [{ jsPDF }] = await Promise.all([import('jspdf')])
    const document = new jsPDF({ format: 'a4', unit: 'pt' })
    document.setFont('helvetica', 'bold')
    document.setFontSize(20)
    document.text('Refund Request Receipt', 44, 54)
    document.setFontSize(10)
    document.setTextColor(75, 85, 99)
    document.text(`Generated ${formatDateTime(new Date().toISOString())}`, 44, 74)
    document.setTextColor(24, 32, 51)
    document.setFont('helvetica', 'normal')
    const rows = [
      ['Reference', request.reference_number],
      ['Order', request.order_number],
      ['Product', request.product_name],
      ['Customer', request.customers?.full_name ?? 'Customer'],
      [
        'Amount',
        Number(request.amount_requested) > 0
          ? `$${Number(request.amount_requested).toFixed(2)}`
          : 'Pending staff verification',
      ],
      ['Status', formatStatus(request.status)],
      ['Submitted', formatDateTime(request.created_at)],
    ]
    rows.forEach(([label, value], index) => {
      const y = 112 + index * 30
      document.setFont('helvetica', 'bold')
      document.text(label, 44, y)
      document.setFont('helvetica', 'normal')
      document.text(String(value), 180, y)
    })
    document.setFontSize(9)
    document.setTextColor(75, 85, 99)
    document.text('This receipt confirms submission only. It is not proof that funds were credited.', 44, 350)
    document.save(`refund-receipt-${request.reference_number}.pdf`)
  }

  async function handleStaffRefundSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !profile) return

    if (profile.role !== 'administrator' && profile.role !== 'refund_manager') {
      showCustomerDialog('error', 'Only refund managers and administrators can create requests for customers.')
      return
    }

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const files = form.getAll('documents').filter((file): file is File => file instanceof File)
    const fullName = String(form.get('fullName') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    const phone = String(form.get('phone') ?? '').trim()
    const referenceNumber = String(form.get('referenceNumber') ?? '').trim()
    const orderNumber = String(form.get('orderNumber') ?? '').trim()
    const purchaseDate = String(form.get('purchaseDate') ?? '')
    const refundReason = String(form.get('refundReason') ?? '')
    const preferredPaymentMethod = String(form.get('preferredPaymentMethod') ?? '')
    const productName = String(form.get('productName') ?? staffIntakeProduct)
    const internalNoteText = String(form.get('internalNote') ?? '').trim()
    const amount = Number(form.get('amountRequested'))

    if (!fullName || !email || !referenceNumber || !orderNumber || !amount) {
      showCustomerDialog('error', 'Please complete the required customer and refund details.')
      return
    }

    setIsSubmittingStaffRefund(true)

    const { data: refundId, error: refundError } = await supabase.rpc('create_staff_refund_request', {
      p_amount_requested: amount,
      p_customer_email: email,
      p_customer_full_name: fullName,
      p_customer_phone: phone,
      p_internal_note: internalNoteText || null,
      p_order_number: orderNumber,
      p_preferred_payment_method: preferredPaymentMethod,
      p_product_name: productName,
      p_purchase_date: purchaseDate || null,
      p_reference_number: referenceNumber,
      p_refund_reason: refundReason,
    })

    if (refundError || !refundId) {
      setIsSubmittingStaffRefund(false)
      showCustomerDialog('error', getCustomerFriendlyError(refundError?.message ?? 'Refund request could not be created.'))
      return
    }

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

      const storagePath = `${refundId}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('refund-documents')
        .upload(storagePath, file)

      if (uploadError) {
        showCustomerDialog('error', getCustomerFriendlyError(uploadError.message))
        continue
      }

      const { error: documentError } = await supabase.from('refund_documents').insert({
        refund_request_id: refundId,
        document_type: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        file_size_bytes: file.size,
        uploaded_by: profile.id,
      })

      if (documentError) {
        showCustomerDialog('error', getCustomerFriendlyError(documentError.message))
      }
    }

    setIsSubmittingStaffRefund(false)
    formElement.reset()
    setStaffRefundAmount('')
    setStaffIntakeProduct('McAfee')
    setSelectedRequestId(refundId)
    const notificationDispatched = await dispatchQueuedNotifications(refundId)
    showCustomerDialog(
      notificationDispatched ? 'success' : 'info',
      notificationDispatched
        ? `Refund request ${referenceNumber} was created for ${fullName}. A confirmation email is on its way.`
        : `Refund request ${referenceNumber} was created for ${fullName}. The confirmation email remains queued.`,
    )
    await refreshOperations()
  }

  function showCustomerDialog(kind: NoticeKind, message: string, title?: string) {
    setCustomerDialog({ kind, message, title })
  }

  async function handleCancelRefundRequest() {
    if (!supabase || !cancelTargetRequest || cancelConfirmationText !== 'Cancel refund request') return

    setIsCancellingRefund(true)
    const referenceNumber = cancelTargetRequest.reference_number
    const documentPaths = refundDocuments
      .filter((document) => document.refund_request_id === cancelTargetRequest.id)
      .map((document) => document.storage_path)

    if (documentPaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('refund-documents')
        .remove(documentPaths)

      if (storageError) {
        setIsCancellingRefund(false)
        setCancelTargetRequest(null)
        setCancelConfirmationText('')
        showCustomerDialog(
          'error',
          'The uploaded documents could not be removed securely. Please try again before cancelling this request.',
          'Cancellation could not be completed',
        )
        return
      }
    }

    const { error } = await supabase.rpc('cancel_refund_request', {
      p_refund_request_id: cancelTargetRequest.id,
      p_confirmation: cancelConfirmationText,
    })
    setIsCancellingRefund(false)

    if (error) {
      setCancelTargetRequest(null)
      setCancelConfirmationText('')
      showCustomerDialog(
        'error',
        getCustomerFriendlyError(error.message),
        'Cancellation could not be completed',
      )
      return
    }

    setCancelTargetRequest(null)
    setCancelConfirmationText('')
    setSelectedRequestId((current) => current === cancelTargetRequest.id ? '' : current)
    await refreshOperations()
    showCustomerDialog(
      'success',
      `Refund request ${referenceNumber} was cancelled and permanently removed.`,
      'Refund request cancelled',
    )
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

    if (nextStatus === 'rejected' && !internalNote.trim()) {
      setNotice({ kind: 'error', message: 'Enter a rejection reason before rejecting this request.' })
      return
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

    const notificationDispatched = ['approved', 'rejected', 'credited'].includes(nextStatus)
      ? await dispatchQueuedNotifications(request.id)
      : true

    await refreshOperations()
    setActionLoading('')
    setNotice({
      kind: notificationDispatched ? 'success' : 'info',
      message: notificationDispatched
        ? `Request moved to ${formatStatus(nextStatus)}.`
        : `Request moved to ${formatStatus(nextStatus)}. The email remains queued for another delivery attempt.`,
    })
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

  async function handleRequestDocuments() {
    if (!supabase || !selectedRequest || !internalNote.trim()) {
      setNotice({ kind: 'error', message: 'Select an under-review request and describe the required documents.' })
      return
    }

    setActionLoading('request-documents')
    const { error } = await supabase.rpc('request_refund_documents', {
      p_message: internalNote.trim(),
      p_refund_request_id: selectedRequest.id,
    })

    if (error) {
      setActionLoading('')
      setNotice({ kind: 'error', message: error.message })
      return
    }

    const notificationDispatched = await dispatchQueuedNotifications(selectedRequest.id)
    setInternalNote('')
    await refreshOperations()
    setActionLoading('')
    setNotice({
      kind: notificationDispatched ? 'success' : 'info',
      message: notificationDispatched
        ? 'The customer was emailed with the document request.'
        : 'The document request was saved and its email remains queued.',
    })
  }

  async function handleOpenDocument(document: RefundDocumentRow) {
    if (!supabase) return

    setDocumentLoadingId(document.id)
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      setDocumentLoadingId('')
      setNotice({ kind: 'error', message: 'Your session expired. Sign in again to open this document.' })
      return
    }

    try {
      const response = await fetch('/api/document-link', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentId: document.id }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string; url?: string }

      if (!response.ok || !result.url) {
        throw new Error(result.error || 'A secure document link could not be created.')
      }

      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'A secure document link could not be created.',
      })
    } finally {
      setDocumentLoadingId('')
    }
  }

  async function handleUpdateUserRole(user: UserAccountRow, role: UserRole) {
    if (!supabase || !profile) return

    if (!canManageUserAccounts) {
      setNotice({
        kind: 'error',
        message: 'Only the portal administrator can change user roles.',
      })
      return
    }

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
    await loadUsers(profile.email)
    setNotice({ kind: 'success', message: `${user.full_name} is now ${role.replace('_', ' ')}.` })
  }

  async function handleDeleteUserAccount() {
    if (!supabase || !profile || !deleteTargetUser) return

    if (!canManageUserAccounts) {
      setNotice({
        kind: 'error',
        message: 'Only the portal administrator can delete user accounts.',
      })
      return
    }

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
    setDeleteUserError('')

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Your session expired. Sign in again and retry the deletion.')

      const response = await fetch('/api/delete-user', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmation: deleteConfirmationText,
          targetUserId: deleteTargetUser.id,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Account deletion failed.')
    } catch (error) {
      setIsDeletingUser(false)
      setDeleteUserError(error instanceof Error ? error.message : 'Account deletion failed.')
      return
    }

    setIsDeletingUser(false)

    const deletedEmail = deleteTargetUser.email
    await loadUsers(profile.email)
    await loadAuditLogs()
    setDeleteTargetUser(null)
    setDeleteConfirmationText('')
    setDeleteUserError('')
    showCustomerDialog('success', `${deletedEmail} and its related portal records were deleted.`, 'Account deleted')
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

    if (!/^\d{4}$/.test(beneficiaryLast4)) {
      setNotice({ kind: 'error', message: 'Enter only the last 4 digits of the destination account.' })
      return
    }

    setActionLoading('payment')
    const beneficiaryHash = await createBeneficiaryHash(beneficiary)
    const { error } = await supabase.from('payment_transactions').insert({
      refund_request_id: selectedPaymentRequest.id,
      provider: 'manual_bank_record',
      transaction_reference: reference,
      beneficiary_hash: beneficiaryHash,
      beneficiary_last4: beneficiaryLast4,
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
      `Internal payment record ${reference} created. No bank API transmission occurred.`,
    )
    setBeneficiaryName('')
    setBeneficiaryLast4('')
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
        'credited',
        `Payment ${selectedPaymentTransaction.transaction_reference} settled.`,
      )
    }

    await refreshOperations()
    setActionLoading('')
    setNotice({ kind: 'success', message: 'Payment status updated.' })
  }

  async function handleExportReports(format: ReportFormat) {
    const headers = ['Reference', 'Product', 'Customer', 'Email', 'Order', 'Amount', 'Status', 'Created']
    const rows = filteredRequests.map((request) => [
      request.reference_number,
      request.product_name,
      request.customers?.full_name ?? '',
      request.customers?.email ?? '',
      request.order_number,
      Number(request.amount_requested).toFixed(2),
      formatStatus(request.status),
      formatDate(request.created_at),
    ])

    if (rows.length === 0) {
      setNotice({ kind: 'info', message: 'There are no refund records available to export.' })
      return
    }

    const generatedAt = new Date()
    const filenameDate = generatedAt.toISOString().slice(0, 10)
    setActionLoading('export')

    try {
      if (format === 'csv') {
        const csv = [headers, ...rows]
          .map((row) => row.map(escapeCsvCell).join(','))
          .join('\n')
        downloadBlob(
          new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
          `refund-report-${filenameDate}.csv`,
        )
      } else {
        const [{ jsPDF }, { default: autoTable }] = await Promise.all([
          import('jspdf'),
          import('jspdf-autotable'),
        ])
        const document = new jsPDF({ format: 'a4', orientation: 'landscape', unit: 'pt' })
        document.setFont('helvetica', 'bold')
        document.setFontSize(18)
        document.text('Refund Management Portal Report', 40, 42)
        document.setFont('helvetica', 'normal')
        document.setFontSize(9)
        document.setTextColor(71, 85, 105)
        document.text(`Generated: ${formatDateTime(generatedAt.toISOString())}`, 40, 60)
        document.text(
          `Status: ${reportStatusFilter === 'all' ? 'All' : formatStatus(reportStatusFilter)}  |  Product: ${
            reportProductFilter === 'all' ? 'All' : reportProductFilter
          }  |  Search: ${searchTerm.trim().slice(0, 80) || 'None'}`,
          40,
          76,
        )
        document.text(
          `Records: ${reportSummary.count}  |  Total requested: $${reportSummary.totalAmount.toFixed(
            2,
          )}  |  Average: $${reportSummary.averageAmount.toFixed(2)}  |  Credited: ${reportSummary.credited}`,
          40,
          92,
        )
        autoTable(document, {
          body: rows,
          head: [headers],
          margin: { left: 40, right: 40 },
          startY: 108,
          styles: { cellPadding: 5, fontSize: 8, overflow: 'linebreak' },
          headStyles: { fillColor: [30, 64, 175], textColor: 255 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        })
        document.save(`refund-report-${filenameDate}.pdf`)
      }
    } catch {
      setNotice({ kind: 'error', message: `The ${format.toUpperCase()} report could not be generated.` })
      return
    } finally {
      setActionLoading('')
    }

    void logAudit('refund_report_exported', 'refund_request', null, {
      format,
      count: rows.length,
      exportedAt: generatedAt.toISOString(),
      productFilter: reportProductFilter,
      search: searchTerm.trim() || null,
      statusFilter: reportStatusFilter,
      totalAmount: reportSummary.totalAmount,
    })
    setNotice({ kind: 'success', message: `${format.toUpperCase()} report generated.` })
  }

  async function refreshOperations() {
    await loadRefundRequests()
    await loadStatusHistory()
    await loadRefundDocuments()

    if (profile?.role === 'administrator' || profile?.role === 'refund_manager') {
      await loadInternalNotes()
      await loadPaymentTransactions()
      await loadNotifications()
      await loadUsers(profile.email)
    }

    if (profile?.role === 'administrator') {
      await loadAuditLogs()
    }
  }

  async function refreshRealtimeData(role: UserRole) {
    await loadRefundRequests()
    await loadStatusHistory()
    await loadRefundDocuments()

    if (role === 'administrator' || role === 'refund_manager') {
      await loadInternalNotes()
      await loadPaymentTransactions()
      await loadNotifications()
      await loadUsers(profile?.email ?? '')
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

  if (!['/', '/login'].includes(currentPath)) {
    return <NotFoundPage onReturn={() => {
      const nextPath = profile ? '/' : '/login'
      window.history.pushState({}, '', nextPath)
      setCurrentPath(nextPath)
    }} />
  }

  return (
    <main className={`app-shell ${profile ? 'portal-mode' : 'auth-mode'}`} style={portalTheme}>
      <section className="login-panel" aria-label="Secure portal login">
        <div className="brand-lockup">
          <img
            alt={activeAntivirus.label}
            className="brand-mark"
            height="44"
            src={activeAntivirus.icon}
            width="44"
          />
          <div>
            <strong>{activeAntivirus.label} Refund Processing Portal</strong>
            <small>Submit and manage customer refund requests</small>
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
              <span>Return to portal login</span>
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
            onSubmit={mfaChallengeId
              ? handleVerifySignInMfa
              : authMode === 'sign-up'
                ? handleSignUp
                : handleSignIn}
          >
            {mfaChallengeId ? (
              <>
                <div className="login-heading">
                  <p className="eyebrow">Two-factor verification</p>
                  <h1>Enter your authenticator code</h1>
                  <p>Open your authenticator app and enter the current six-digit code.</p>
                </div>
                <label>
                  Authentication code
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    value={mfaCode}
                  />
                </label>
                <button disabled={isAuthLoading || mfaCode.length !== 6} type="submit">
                  {isAuthLoading ? 'Verifying...' : 'Verify and continue'}
                </button>
                <button className="secondary-button" onClick={() => void handleCancelMfaSignIn()} type="button">
                  Cancel
                </button>
              </>
            ) : (
              <>
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
                    Create customer account
                  </button>
                </div>
                <div className="login-heading">
                  <p className="eyebrow">{authMode === 'sign-up' ? 'Customer registration' : 'Verified access'}</p>
                  <h1>
                    {authMode === 'sign-up' ? 'Create your customer account' : 'Sign in to your refund portal'}
                  </h1>
                  <p>
                    {authMode === 'sign-up'
                      ? 'Create an account using the email connected to your purchase.'
                      : 'Use the verified account connected to your customer order or staff access.'}
                  </p>
                </div>
                {authMode === 'sign-up' && (
                  <label>
                    Full name
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
                  Email address
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
                    autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
                    minLength={authMode === 'sign-up' ? 8 : undefined}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    required
                    type="password"
                    value={authPassword}
                  />
                </label>
                <button disabled={!hasSupabaseConfig || isAuthLoading || isResetLoading} type="submit">
                  {isAuthLoading
                    ? authMode === 'sign-up'
                      ? 'Creating account...'
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
                <p className="login-support-copy">
                  {authMode === 'sign-up'
                    ? 'Email verification is required. Creating an account does not create or change an order.'
                    : 'Customers can create an account here and submit an order for staff verification.'}
                </p>
              </>
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
            <button onClick={() => setAuthDialog('confirm-sign-out')} type="button">
              Sign out
            </button>
          </div>
        )}

        {(!profile || notice.kind !== 'info') && (
          <p className={`notice ${notice.kind}`}>{notice.message}</p>
        )}
      </section>

      <section className="portal-panel">
        <header className="portal-header">
          <div className="portal-topbar">
            <div className="portal-topbar-brand">
              <img alt="" aria-hidden="true" src={activeAntivirus.icon} />
              <div>
                <strong>Refund Management Portal</strong>
                <span>{profile?.full_name}</span>
              </div>
            </div>
            <nav aria-label="Account and support">
              <a href="#portal-help">Help</a>
              <a href="#portal-contact">Contact</a>
              <button onClick={() => void handleOpenSecurityDialog()} type="button">
                Security
              </button>
              <button onClick={() => setAuthDialog('confirm-sign-out')} type="button">
                Sign out
              </button>
            </nav>
          </div>
          <div className="portal-title-row">
            <div>
              <p className="eyebrow">Refund operations</p>
              <h1>{activeView === 'customer' && profile?.role === 'customer' ? 'Your refunds' : 'Operations workspace'}</h1>
            </div>
            <p>
              {profile?.role === 'customer'
                ? 'Submit an order for verification and follow every refund status update.'
                : 'Verify customer orders, review requests, and record payment outcomes.'}
            </p>
          </div>
        </header>

        {isSessionRestoring && (
          <div className="portal-loading-overlay" role="status">
            <div className="portal-loading-card">
              <span>Loading secure session</span>
              <strong>Preparing your portal workspace</strong>
              <p>Fetching account access, refund records, and operational data.</p>
            </div>
          </div>
        )}

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
          <section className={`content-grid ${profile?.role === 'customer' ? 'customer-refund-layout' : ''}`}>
            {profile?.role === 'administrator' ? (
              <section className="work-card customer-operations-card">
                <div className="section-heading row-heading">
                  <div>
                    <p className="eyebrow">Customer operations</p>
                    <h2>Customer refund requests</h2>
                  </div>
                  <span className="realtime-badge">Live customer records</span>
                </div>
                <input
                  className="search-input"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search customers, references, orders, or products"
                  type="search"
                  value={searchTerm}
                />
                <div className="request-list admin-customer-request-list">
                  {customerPanelRequests.map((request) => (
                    <RequestSummaryCard
                      documents={refundDocuments.filter((document) => document.refund_request_id === request.id)}
                      documentLoadingId={documentLoadingId}
                      key={request.id}
                      onOpenDocument={handleOpenDocument}
                      request={request}
                      showCustomer
                    />
                  ))}
                  {customerPanelRequests.length === 0 && (
                    <p className="empty-state">No customer refund requests found.</p>
                  )}
                </div>
              </section>
            ) : (
              <form
                className="work-card guided-refund-form"
                key={profile?.id}
                onSubmit={handleRefundSubmit}
              >
                <div className="guided-form-heading">
                  <div>
                    <p className="eyebrow">Customer refund form</p>
                    <h2>Submit refund request</h2>
                  </div>
                  <p>Submit your order details now. Staff will verify the refund amount during review.</p>
                </div>

                <section className="guided-form-section customer-full-form-grid">
                    <div className="field-section-heading full-span">
                      <h3>Customer and order details</h3>
                      <p>Fields marked as verified come from your signed-in account.</p>
                    </div>
                    <label>
                      Customer full name
                      <input readOnly value={profile?.full_name ?? ''} />
                    </label>
                    <label>
                      Customer email
                      <input readOnly type="email" value={profile?.email ?? ''} />
                    </label>
                    <label>
                      Customer phone number
                      <input
                        autoComplete="tel"
                        onChange={(event) => setCustomerPhone(event.target.value)}
                        placeholder="Customer phone number"
                        required
                        type="tel"
                        value={customerPhone}
                      />
                    </label>
                    <label>
                      Refund reference number
                      <input placeholder="Generated automatically after submission" readOnly />
                    </label>
                    <label>
                      <span className="label-with-help">
                        Order number
                        <button
                          aria-label="Where to find your order number"
                          className="field-help"
                          title="Find this number in your purchase confirmation or receipt."
                          type="button"
                        >
                          ?
                        </button>
                      </span>
                      <input
                        autoComplete="off"
                        onBlur={(event) => setCustomerOrderLookup(event.target.value.trim())}
                        onChange={(event) => setCustomerOrderLookup(event.target.value)}
                        placeholder="Order number"
                        required
                        value={customerOrderLookup}
                      />
                    </label>
                    <label>
                      Purchase date
                      <input
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(event) => setCustomerPurchaseDate(event.target.value)}
                        required
                        type="date"
                        value={customerPurchaseDate}
                      />
                    </label>
                    <label className="full-span">
                      Antivirus product
                      <select
                        aria-label="Antivirus product"
                        onChange={(event) => {
                          setCustomerAntivirus(event.target.value)
                          setSelectedAntivirus(event.target.value)
                        }}
                        required
                        value={customerAntivirus}
                      >
                        {antivirusOptions.map((option) => (
                          <option key={option.label} value={option.label}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="product-preview full-span">
                      <img alt="" aria-hidden="true" src={getAntivirusOption(customerAntivirus).icon} />
                      <div><span>Selected antivirus</span><strong>{customerAntivirus}</strong></div>
                    </div>
                    <div className="customer-safety-notice full-span" role="note">
                      <span aria-hidden="true">i</span>
                      <p>
                        Staff will verify the order, purchase date, refundable amount, and payment method.
                        Never provide passwords, full card numbers, or bank login details.
                      </p>
                    </div>
                </section>

                <section className="guided-form-section customer-full-form-grid">
                  <div className="field-section-heading full-span">
                    <h3>Refund details</h3>
                    <p>Enter the amount and method from your purchase. Staff will verify both before approval.</p>
                  </div>
                  <label>
                    Reason for cancellation
                    <select
                      onChange={(event) => setCustomerRefundReason(event.target.value)}
                      required
                      value={customerRefundReason}
                    >
                      <option value="">Select a reason</option>
                      <option>Duplicate charge</option>
                      <option>Service cancellation</option>
                      <option>Product did not work as expected</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label>
                    Amount requested
                    <input
                      min="0.01"
                      onChange={(event) => setCustomerRequestedAmount(event.target.value)}
                      placeholder="0.00"
                      required
                      step="0.01"
                      type="number"
                      value={customerRequestedAmount}
                    />
                    <small className="field-support-text">Subject to staff verification.</small>
                  </label>
                  <label>
                    Preferred refund method
                    <select
                      onChange={(event) => setCustomerPreferredMethod(event.target.value)}
                      required
                      value={customerPreferredMethod}
                    >
                      <option value="">Select a method</option>
                      <option>Original payment method</option>
                      <option>Manual bank transfer</option>
                      <option>Store credit</option>
                    </select>
                  </label>
                  <label
                    className="file-drop-zone"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      handleCustomerFiles(event.dataTransfer.files)
                    }}
                  >
                    <span className="file-drop-icon" aria-hidden="true">+</span>
                    <strong>Upload documents</strong>
                    <small>Drag files here or browse. PDF, JPG, or PNG, up to 10 MB each.</small>
                    <input
                      accept=".pdf,.jpg,.jpeg,.png"
                      aria-label="Upload supporting documents"
                      multiple
                      onChange={(event) => event.target.files && handleCustomerFiles(event.target.files)}
                      type="file"
                    />
                  </label>
                  {customerDocuments.length > 0 && (
                    <div className="file-preview-list full-span">
                      {customerDocuments.map((file) => (
                        <CustomerFilePreview
                          file={file}
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          onRemove={() => setCustomerDocuments((current) => current.filter((item) => item !== file))}
                        />
                      ))}
                    </div>
                  )}
                  <label className="full-span">
                    Intake notes <span className="optional-label">Optional</span>
                    <textarea
                      maxLength={500}
                      onChange={(event) => setCustomerRefundDetails(event.target.value)}
                      placeholder="Add information that may help the review team. Do not include payment credentials."
                      rows={4}
                      value={customerRefundDetails}
                    />
                    <small className="character-count">{customerRefundDetails.length}/500</small>
                  </label>
                  <label className="confirmation-check full-span">
                    <input required type="checkbox" />
                    <span>I confirm that these order details are accurate and belong to me.</span>
                  </label>
                  <button
                    className="primary-action full-span"
                    disabled={!supabase || isSubmittingRefund}
                    type="submit"
                  >
                    {isSubmittingRefund ? 'Submitting...' : 'Submit refund request'}
                  </button>
                </section>
              </form>
            )}

            {profile?.role !== 'administrator' && (
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
                      {customerPanelRequests.map((request) => (
                        <RequestSummaryCard
                          documents={refundDocuments.filter((document) => document.refund_request_id === request.id)}
                          documentLoadingId={documentLoadingId}
                          key={request.id}
                          onCancel={profile.role === 'customer' && request.status === 'submitted'
                            ? () => {
                                setCancelTargetRequest(request)
                                setCancelConfirmationText('')
                              }
                            : undefined}
                          onOpenDocument={handleOpenDocument}
                          onDownloadReceipt={() => void handleDownloadReceipt(request)}
                          request={request}
                          timeline={statusHistory.filter((item) => item.refund_request_id === request.id)}
                        />
                      ))}
                      {customerPanelRequests.length === 0 && (
                        <p className="empty-state">No refund requests yet. Use the form above to submit one.</p>
                      )}
                    </div>
                  ) : (
                    <p className="empty-state">Your submitted refund requests will appear here.</p>
                  )}
                </section>
              </aside>
            )}
            {profile?.role === 'customer' && (
              <section className="customer-help-section" id="help">
                <div className="field-section-heading">
                  <p className="eyebrow">Refund help</p>
                  <h2>Frequently asked questions</h2>
                </div>
                <div className="faq-grid">
                  <details>
                    <summary>Which orders are eligible?</summary>
                    <p>Only orders entered and marked eligible by the refund operations team can be submitted.</p>
                  </details>
                  <details>
                    <summary>How long does review take?</summary>
                    <p>Timing depends on verification and payment processing. Your request timeline updates automatically.</p>
                  </details>
                  <details>
                    <summary>How is the amount decided?</summary>
                    <p>The refundable amount is recorded from the order by authorized staff and cannot be edited by customers.</p>
                  </details>
                  <details id="contact">
                    <summary>What if my request is denied or my order is missing?</summary>
                    <p>Contact the refund operations team and provide the order number shown on your purchase receipt.</p>
                  </details>
                </div>
              </section>
            )}
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

            <form className="work-card form-grid staff-intake-card" onSubmit={handleStaffRefundSubmit}>
              <div className="section-heading">
                <p className="eyebrow">Staff refund intake</p>
                <h2>Create request for customer</h2>
              </div>
              <label>
                Customer Full Name
                <input autoComplete="name" name="fullName" placeholder="Customer full name" required />
              </label>
              <label>
                Customer Email
                <input
                  autoComplete="email"
                  name="email"
                  placeholder="customer@example.com"
                  required
                  type="email"
                />
              </label>
              <label>
                Customer Phone Number
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
              <label className="full-span">
                Antivirus Product
                <select
                  name="productName"
                  onChange={(event) => setStaffIntakeProduct(event.target.value)}
                  required
                  value={staffIntakeProduct}
                >
                  {antivirusOptions.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="product-preview full-span">
                <img alt={staffIntakeAntivirus.label} src={staffIntakeAntivirus.icon} />
                <div>
                  <span>Selected antivirus</span>
                  <strong>{staffIntakeAntivirus.label}</strong>
                </div>
              </div>
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
                  min="0.01"
                  name="amountRequested"
                  onChange={(event) => setStaffRefundAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={staffRefundAmount}
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
              <label className="full-span">
                Intake Notes
                <textarea
                  name="internalNote"
                  placeholder="Record why staff created this request and any customer-provided details."
                />
              </label>
              <div className="document-checklist">
                <span>Purchase Receipt</span>
                <span>Cancellation Proof</span>
              </div>
              <button
                className="primary-action"
                disabled={!supabase || !profile || isSubmittingStaffRefund}
                type="submit"
              >
                {isSubmittingStaffRefund ? 'Creating request...' : 'Create customer refund request'}
              </button>
            </form>

            <div className="content-grid">
              <section className="work-card">
                <div className="section-heading row-heading">
                  <div>
                    <p className="eyebrow">Refund manager dashboard</p>
                    <h2>Assigned requests</h2>
                  </div>
                  <input
                    className="search-input"
                    maxLength={120}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search Customers"
                    value={searchTerm}
                  />
                </div>
                <div className="report-toolbar">
                  <label>
                    Status
                    <select
                      onChange={(event) => setReportStatusFilter(event.target.value)}
                      value={reportStatusFilter}
                    >
                      <option value="all">All statuses</option>
                      {reportStatuses.map((status) => (
                        <option key={status} value={status}>
                          {formatStatus(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Antivirus
                    <select
                      onChange={(event) => setReportProductFilter(event.target.value)}
                      value={reportProductFilter}
                    >
                      <option value="all">All antivirus products</option>
                      {antivirusOptions.map((option) => (
                        <option key={option.label} value={option.label}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Export format
                    <select
                      onChange={(event) => setReportFormat(event.target.value as ReportFormat)}
                      value={reportFormat}
                    >
                      <option value="csv">CSV spreadsheet</option>
                      <option value="pdf">PDF report</option>
                    </select>
                  </label>
                </div>
                <dl className="report-summary" aria-label="Filtered report summary">
                  <div>
                    <dt>Visible records</dt>
                    <dd>{reportSummary.count}</dd>
                  </div>
                  <div>
                    <dt>Total requested</dt>
                    <dd>${reportSummary.totalAmount.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Average request</dt>
                    <dd>${reportSummary.averageAmount.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Credited</dt>
                    <dd>{reportSummary.credited}</dd>
                  </div>
                </dl>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Customer</th>
                        <th>Product</th>
                        <th>Order</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Handler</th>
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
                          <td data-label="Product">{request.product_name}</td>
                          <td data-label="Order">{request.order_number}</td>
                          <td data-label="Amount">
                            {Number(request.amount_requested) > 0
                              ? `$${Number(request.amount_requested).toFixed(2)}`
                              : Number(request.customer_requested_amount) > 0
                                ? `$${Number(request.customer_requested_amount).toFixed(2)} requested`
                                : 'Pending verification'}
                          </td>
                          <td data-label="Status">
                            <span className="status-pill">{formatStatus(request.status)}</span>
                          </td>
                          <td data-label="Handler">
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
                      ['approved', 'rejected', 'payment_processing', 'credited', 'completed'].includes(
                        selectedRequest.status,
                      ) ||
                      !internalNote.trim() ||
                      actionLoading === 'rejected'
                    }
                    onClick={() =>
                      void changeRequestStatus(selectedRequest, 'rejected', 'Refund rejected.')
                    }
                    title={
                      selectedRequest &&
                      ['approved', 'rejected', 'payment_processing', 'credited', 'completed'].includes(
                        selectedRequest.status,
                      )
                        ? `Request is already ${formatStatus(selectedRequest.status)}.`
                        : selectedRequest && !internalNote.trim()
                          ? 'Enter a rejection reason in the notes field first.'
                        : ''
                    }
                    type="button"
                  >
                    Reject
                  </button>
                  <button
                    disabled={filteredRequests.length === 0 || actionLoading === 'export'}
                    onClick={() => void handleExportReports(reportFormat)}
                    title={
                      filteredRequests.length === 0
                        ? 'No refund records available to export.'
                        : `Export visible refund records as ${reportFormat.toUpperCase()}.`
                    }
                    type="button"
                  >
                    {actionLoading === 'export' ? 'Generating...' : `Export ${reportFormat.toUpperCase()}`}
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
                {selectedRequest && (
                  <div className="manager-product-panel">
                    <img alt={activeAntivirus.label} src={activeAntivirus.icon} />
                    <label>
                      Antivirus interface
                      <select
                        aria-readonly="true"
                        disabled
                        value={selectedRequest.product_name}
                      >
                        {antivirusOptions.map((option) => (
                          <option key={option.label} value={option.label}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {selectedRequest &&
                  selectedRequest.status === 'submitted' &&
                  (Number(selectedRequest.amount_requested) <= 0 ||
                    !selectedRequest.purchase_date ||
                    selectedRequest.preferred_payment_method === 'Pending staff verification') && (
                    <form
                      className="manager-order-verification"
                      key={`verify-${selectedRequest.id}`}
                      onSubmit={handleVerifyCustomerOrder}
                    >
                      <div className="field-section-heading">
                        <p className="eyebrow">Order verification</p>
                        <h3>Record verified refund details</h3>
                        <p>Confirm these details from the purchase record before starting review.</p>
                      </div>
                      <label>
                        Purchase date
                        <input
                          defaultValue={selectedRequest.customer_purchase_date ?? ''}
                          max={new Date().toISOString().slice(0, 10)}
                          name="purchaseDate"
                          required
                          type="date"
                        />
                      </label>
                      <label>
                        Verified refund amount
                        <input
                          defaultValue={selectedRequest.customer_requested_amount ?? undefined}
                          min="0.01"
                          name="refundAmount"
                          required
                          step="0.01"
                          type="number"
                        />
                      </label>
                      <label>
                        Refund method
                        <select
                          defaultValue={selectedRequest.customer_preferred_payment_method ?? 'Original payment method'}
                          name="refundMethod"
                          required
                        >
                          <option>Original payment method</option>
                          <option>Store credit</option>
                          <option>Manual bank transfer</option>
                        </select>
                      </label>
                      <button className="primary-action" disabled={actionLoading === 'verify-order'} type="submit">
                        {actionLoading === 'verify-order' ? 'Saving details...' : 'Verify order details'}
                      </button>
                    </form>
                  )}
                {selectedRequest && (
                  <DocumentList
                    documents={refundDocuments.filter(
                      (document) => document.refund_request_id === selectedRequest.id,
                    )}
                    loadingId={documentLoadingId}
                    onOpen={handleOpenDocument}
                  />
                )}
                <textarea
                  onChange={(event) => setInternalNote(event.target.value)}
                  placeholder="Add internal comments for the selected request."
                  value={internalNote}
                />
                <div className="button-row">
                  <button
                    className="secondary-action"
                    disabled={!selectedRequest || !internalNote.trim() || actionLoading === 'note'}
                    onClick={() => void handleSaveInternalNote()}
                    type="button"
                  >
                    Save note
                  </button>
                  <button
                    disabled={
                      !selectedRequest ||
                      selectedRequest.status !== 'under_review' ||
                      !internalNote.trim() ||
                      documentsAlreadyRequested ||
                      actionLoading === 'request-documents'
                    }
                    onClick={() => void handleRequestDocuments()}
                    title={
                      documentsAlreadyRequested
                        ? 'Documents were already requested for this refund.'
                        : selectedRequest?.status !== 'under_review'
                          ? 'Start the manager review before requesting documents.'
                          : 'Email the customer with the document request entered above.'
                    }
                    type="button"
                  >
                    Request documents
                  </button>
                </div>
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
                <form className="work-card form-grid account-create-form" onSubmit={handleCreateUserAccount}>
                  <div className="section-heading">
                    <p className="eyebrow">Account administration</p>
                    <h2>Create user account</h2>
                  </div>
                  <label>
                    Full Name
                    <input
                      autoComplete="off"
                      maxLength={120}
                      onChange={(event) => setNewAccountFullName(event.target.value)}
                      placeholder="Account holder name"
                      required
                      value={newAccountFullName}
                    />
                  </label>
                  <label>
                    Email Address
                    <input
                      autoComplete="off"
                      maxLength={254}
                      onChange={(event) => setNewAccountEmail(event.target.value)}
                      placeholder="name@example.com"
                      required
                      type="email"
                      value={newAccountEmail}
                    />
                  </label>
                  <label>
                    Temporary Password
                    <input
                      autoComplete="new-password"
                      maxLength={72}
                      minLength={8}
                      onChange={(event) => setNewAccountPassword(event.target.value)}
                      placeholder="Minimum 8 characters"
                      required
                      type="password"
                      value={newAccountPassword}
                    />
                  </label>
                  <label>
                    Account Role
                    <select
                      onChange={(event) => setNewAccountRole(event.target.value as UserRole)}
                      value={newAccountRole}
                    >
                      <option value="customer">Customer</option>
                      <option value="refund_manager">Refund manager</option>
                      {isHeadAdministrator(profile?.email ?? '') && (
                        <option value="administrator">Administrator</option>
                      )}
                    </select>
                  </label>
                  {!isHeadAdministrator(profile?.email ?? '') && (
                    <p className="account-role-note full-span">
                      Contact the portal administrator to create an Administrator account.
                    </p>
                  )}
                  <button
                    className="primary-action"
                    disabled={!supabase || isCreatingAccount}
                    type="submit"
                  >
                    {isCreatingAccount ? 'Creating account...' : 'Create account'}
                  </button>
                </form>

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
                          <th>Created</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const verificationStatus = getVerificationStatus(user)
                          const deleteDisabled =
                            !canManageUserAccounts ||
                            isHeadAdministrator(user.email) ||
                            user.id === profile?.id

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
                                  disabled={!canManageUserAccounts || isHeadAdministrator(user.email)}
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
                              <td data-label="Created">{formatDate(user.created_at)}</td>
                              <td data-label="Action">
                                <button
                                  aria-label={`Delete ${user.full_name}`}
                                  className="table-action-button danger icon-button"
                                  disabled={deleteDisabled}
                                  onClick={() => {
                                    setDeleteTargetUser(user)
                                    setDeleteConfirmationText('')
                                    setDeleteUserError('')
                                  }}
                                  title={
                                    !canManageUserAccounts
                                      ? 'Only the portal administrator can delete user accounts'
                                      : deleteDisabled
                                      ? 'Protected or active-session account'
                                      : 'Delete this user account'
                                  }
                                  type="button"
                                >
                                  X
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
                  <div className="section-heading row-heading">
                    <div>
                      <p className="eyebrow">Immutable audit log</p>
                      <h2>Recent events</h2>
                    </div>
                    <span className="realtime-badge">Live audit</span>
                  </div>
                  <ol className="audit-list">
                    {visibleAuditEntries.map((event) => (
                      <li key={event.id}>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                        <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                  {auditEntries.length > visibleAuditEntries.length && (
                    <p className="audit-list-note">
                      Showing latest {visibleAuditEntries.length} relevant events.
                    </p>
                  )}
                  {auditEntries.length === 0 && (
                    <p className="empty-state">No relevant audit events yet.</p>
                  )}
                </section>
              </aside>
            </div>
          </section>
        )}

        {activeView === 'bank' && (
          <section className="boa-workspace">
            <header className="boa-header">
              <div className="boa-brand">
                <span aria-hidden="true" className="boa-brand-mark">
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <strong>BANK OF AMERICA</strong>
                  <span>Payment Operations</span>
                </div>
              </div>
              <div className="boa-connection-state">
                <span aria-hidden="true" />
                API not connected
              </div>
            </header>

            <div className="boa-notice" role="status">
              <strong>Internal payment recording only</strong>
              <p>
                This portal is not connected to Bank of America. Staff may record and reconcile a
                payment handled outside the portal, but no funds are transmitted from this screen.
              </p>
            </div>

            <div className="boa-layout">
              <section className="boa-main-stack">
                <section className="work-card boa-payment-card">
                  <div className="boa-section-heading">
                    <div>
                      <p className="eyebrow">Refund disbursement</p>
                      <h2>Prepare payment</h2>
                    </div>
                    <span className="boa-draft-badge">Manual processing</span>
                  </div>

                  <label>
                    Approved refund
                    <select
                      onChange={(event) => setSelectedRequestId(event.target.value)}
                      value={selectedPaymentRequest?.id ?? ''}
                    >
                      <option disabled value="">
                        Select an approved refund
                      </option>
                      {paymentReadyRequests.map((request) => (
                        <option key={request.id} value={request.id}>
                          {request.reference_number} - {request.customers?.full_name ?? 'Unknown'} - $
                          {Number(request.amount_requested).toFixed(2)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="boa-refund-summary">
                    <div>
                      <span>Customer</span>
                      <strong>{selectedPaymentRequest?.customers?.full_name ?? 'No refund selected'}</strong>
                    </div>
                    <div>
                      <span>Reference</span>
                      <strong>{selectedPaymentRequest?.reference_number ?? '-'}</strong>
                    </div>
                    <div>
                      <span>Order</span>
                      <strong>{selectedPaymentRequest?.order_number ?? '-'}</strong>
                    </div>
                    <div>
                      <span>Amount</span>
                      <strong>
                        {selectedPaymentRequest
                          ? `$${Number(selectedPaymentRequest.amount_requested).toFixed(2)}`
                          : '-'}
                      </strong>
                    </div>
                  </div>

                  <div className="boa-form-grid">
                    <label>
                      Beneficiary name
                      <input
                        onChange={(event) => setBeneficiaryName(event.target.value)}
                        placeholder="Name on destination account"
                        value={beneficiaryName}
                      />
                    </label>
                    <label>
                      Destination account
                      <input
                        inputMode="numeric"
                        maxLength={4}
                        onChange={(event) =>
                          setBeneficiaryLast4(event.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        placeholder="Last 4 digits"
                        value={beneficiaryLast4}
                      />
                    </label>
                    <label>
                      Transaction reference
                      <input
                        onChange={(event) => setTransactionReference(event.target.value)}
                        placeholder="Auto-generated if blank"
                        value={transactionReference}
                      />
                    </label>
                    <label>
                      Payment status
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
                  </div>

                  <div className="boa-action-bar">
                    <p>
                      This creates an internal record only. Complete the actual payment through the
                      authorized bank process.
                    </p>
                    <button
                      disabled={
                        !selectedPaymentRequest ||
                        Boolean(selectedPaymentTransaction) ||
                        actionLoading === 'payment'
                      }
                      onClick={() => void handleCreatePayment()}
                      title="Create a record for a payment handled outside the portal"
                      type="button"
                    >
                      {selectedPaymentTransaction ? 'Payment record created' : 'Create payment record'}
                    </button>
                    <button
                      className="boa-secondary-button"
                      disabled={!selectedPaymentTransaction || actionLoading === 'payment-status'}
                      onClick={() => void handleUpdatePaymentStatus()}
                      title="Save the selected manual payment status"
                      type="button"
                    >
                      Update status manually
                    </button>
                  </div>
                </section>

                <section className="work-card boa-history-card">
                  <div className="boa-section-heading">
                    <div>
                      <p className="eyebrow">Transaction activity</p>
                      <h2>Payment records</h2>
                    </div>
                    <span>{paymentTransactions.length} records</span>
                  </div>
                  <div className="boa-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Transaction</th>
                          <th>Amount</th>
                          <th>Account</th>
                          <th>Status</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentTransactions.map((transaction) => (
                          <tr key={transaction.id}>
                            <td data-label="Transaction">{transaction.transaction_reference}</td>
                            <td data-label="Amount">${Number(transaction.amount).toFixed(2)}</td>
                            <td data-label="Account">
                              {transaction.beneficiary_last4 ? `Ending ${transaction.beneficiary_last4}` : '-'}
                            </td>
                            <td data-label="Status">
                              <span className={`boa-status ${transaction.status}`}>
                                {formatStatus(transaction.status)}
                              </span>
                            </td>
                            <td data-label="Updated">{formatDateTime(transaction.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {paymentTransactions.length === 0 && (
                      <p className="empty-state">No internal payment records yet.</p>
                    )}
                  </div>
                </section>
              </section>

              <aside className="boa-side-stack">
                <section className="work-card boa-readiness-card">
                  <div className="section-heading">
                    <p className="eyebrow">Integration readiness</p>
                    <h2>Connection checklist</h2>
                  </div>
                  <ol className="boa-checklist">
                    <li className="complete"><span>1</span><div><strong>Portal workflow</strong><p>Approved refunds are ready for payment preparation.</p></div></li>
                    <li className="complete"><span>2</span><div><strong>Manual reconciliation</strong><p>Staff can record external payment references and settlement.</p></div></li>
                    <li><span>3</span><div><strong>API approval</strong><p>Official access and written authorization are still required.</p></div></li>
                    <li><span>4</span><div><strong>API activation</strong><p>Automated transmission requires sandbox acceptance testing.</p></div></li>
                  </ol>
                  <dl className="boa-details">
                    <div><dt>Selected refund</dt><dd>{selectedPaymentRequest?.reference_number ?? 'None'}</dd></div>
                    <div><dt>Estimated processing</dt><dd>{paymentEta}</dd></div>
                    <div><dt>Processing mode</dt><dd>Manual record</dd></div>
                  </dl>
                </section>

                <section className="work-card boa-notification-card">
                  <div className="section-heading">
                    <p className="eyebrow">Customer communication</p>
                    <h2>Email delivery</h2>
                  </div>
                  <div className="boa-notification-list">
                    {notifications.slice(0, 5).map((notification) => (
                      <article key={notification.id}>
                        <div>
                          <strong>{notification.subject ?? titleCase(notification.template.replaceAll('_', ' '))}</strong>
                          <span>{notification.recipient}</span>
                        </div>
                        <span className={`boa-status ${notification.status}`}>
                          {formatStatus(notification.status)}
                        </span>
                      </article>
                    ))}
                    {notifications.length === 0 && (
                      <p className="empty-state">No email delivery records yet.</p>
                    )}
                  </div>
                </section>
              </aside>
            </div>

            <footer className="boa-disclaimer">
              Bank of America is a third-party financial institution. This internal refund portal is
              not a Bank of America website and does not currently connect to its services. Record
              Settled only after staff confirm the external bank payment.
            </footer>
          </section>
        )}
        <footer className="portal-footer">
          <div id="portal-help">
            <strong>Help</strong>
            <span>Use the order number from the purchase receipt. Staff can verify missing order records.</span>
          </div>
          <div id="portal-contact">
            <strong>Contact</strong>
            <span>Contact your authorized refund operations team or portal administrator for account assistance.</span>
          </div>
        </footer>
      </section>

      {securityDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="security-dialog-title" aria-modal="true" className="customer-dialog info security-dialog" role="dialog">
            <div>
              <p className="eyebrow">Account security</p>
              <h2 id="security-dialog-title">Two-factor authentication</h2>
            </div>
            {hasVerifiedMfa ? (
              <>
                <p>Your account requires an authenticator code after password sign-in.</p>
                <button className="danger-button" onClick={() => void handleDisableMfa()} type="button">
                  Disable two-factor authentication
                </button>
              </>
            ) : mfaEnrollmentId ? (
              <>
                <p>Scan this code with an authenticator app, then enter the six-digit code.</p>
                {mfaEnrollmentQr && <img alt="Authenticator setup QR code" className="mfa-qr" src={mfaEnrollmentQr} />}
                <label>
                  Manual setup key
                  <input readOnly value={mfaEnrollmentSecret} />
                </label>
                <label>
                  Authentication code
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setMfaEnrollmentCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    value={mfaEnrollmentCode}
                  />
                </label>
                <button disabled={mfaEnrollmentCode.length !== 6} onClick={() => void handleVerifyMfaEnrollment()} type="button">
                  Verify and enable
                </button>
              </>
            ) : (
              <>
                <p>Add an optional authenticator app as a second verification step when signing in.</p>
                <button onClick={() => void handleBeginMfaEnrollment()} type="button">Set up authenticator</button>
              </>
            )}
            <button className="secondary-button" onClick={() => setSecurityDialogOpen(false)} type="button">Close</button>
          </section>
        </div>
      )}

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
                {customerDialog.title ?? (customerDialog.kind === 'success'
                  ? 'Refund request received'
                  : 'Please review your request')}
              </h2>
            </div>
            <p>{customerDialog.message}</p>
            <button onClick={() => setCustomerDialog(null)} type="button">
              Close
            </button>
          </section>
        </div>
      )}

      {authDialog && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="auth-dialog-title"
            aria-modal="true"
            className="customer-dialog danger"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Secure session</p>
              <h2 id="auth-dialog-title">Sign out of the portal?</h2>
            </div>
            <p>
              This will end your current session on this browser. Any unsaved form entries will be
              cleared.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={isSigningOut}
                onClick={() => setAuthDialog(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                type="button"
              >
                {isSigningOut ? 'Signing out...' : 'Log out'}
              </button>
            </div>
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
            {deleteUserError && <p className="modal-inline-error" role="alert">{deleteUserError}</p>}
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setDeleteTargetUser(null)
                  setDeleteConfirmationText('')
                  setDeleteUserError('')
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

      {cancelTargetRequest && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="cancel-refund-dialog-title"
            aria-modal="true"
            className="customer-dialog danger"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Permanent cancellation</p>
              <h2 id="cancel-refund-dialog-title">Cancel refund request?</h2>
            </div>
            <p>
              Request <strong>{cancelTargetRequest.reference_number}</strong> and its uploaded
              documents will be permanently removed. This action cannot be undone. Type{' '}
              <strong>Cancel refund request</strong> to confirm.
            </p>
            <input
              aria-label="Cancel refund confirmation text"
              className="delete-confirm-input"
              onChange={(event) => setCancelConfirmationText(event.target.value)}
              placeholder="Cancel refund request"
              value={cancelConfirmationText}
            />
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={isCancellingRefund}
                onClick={() => {
                  setCancelTargetRequest(null)
                  setCancelConfirmationText('')
                }}
                type="button"
              >
                Keep request
              </button>
              <button
                className="danger-button"
                disabled={isCancellingRefund || cancelConfirmationText !== 'Cancel refund request'}
                onClick={() => void handleCancelRefundRequest()}
                type="button"
              >
                {isCancellingRefund ? 'Cancelling...' : 'Cancel request'}
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

function RequestSummaryCard({
  documents = [],
  documentLoadingId = '',
  onCancel,
  onDownloadReceipt,
  onOpenDocument,
  request,
  showCustomer = false,
  timeline = [],
}: {
  documents?: RefundDocumentRow[]
  documentLoadingId?: string
  onCancel?: () => void
  onDownloadReceipt?: () => void
  onOpenDocument?: (document: RefundDocumentRow) => void | Promise<void>
  request: RefundRequestRow
  showCustomer?: boolean
  timeline?: StatusHistoryRow[]
}) {
  const orderedTimeline = [...timeline].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const trackingStages = ['submitted', 'under_review', 'approved', 'credited']
  const trackingStatus = request.status === 'documents_verified' ? 'under_review' : request.status
  const trackingIndex = trackingStages.indexOf(trackingStatus)
  const estimatedResolution = new Date(request.created_at)
  estimatedResolution.setDate(estimatedResolution.getDate() + 10)

  return (
    <article className="request-summary">
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
      {showCustomer && (
        <div className="request-customer-line">
          <span>Customer</span>
          <strong>{request.customers?.full_name ?? 'Unknown customer'}</strong>
          <small>{request.customers?.email ?? 'No email recorded'}</small>
        </div>
      )}
      <span className="status-pill">{formatStatus(request.status)}</span>
      <div className="customer-status-progress" aria-label={`Current status: ${formatStatus(request.status)}`}>
        {trackingStages.map((stage, index) => {
          const timelineItem = orderedTimeline.find((item) =>
            stage === 'under_review'
              ? ['under_review', 'documents_verified'].includes(item.to_status)
              : item.to_status === stage,
          )
          const reached = trackingIndex >= index || Boolean(timelineItem)
          return (
            <div className={reached ? 'reached' : ''} key={stage}>
              <span aria-hidden="true">{index + 1}</span>
              <strong>{stage === 'credited' ? 'Refunded' : formatStatus(stage)}</strong>
              <small>{timelineItem ? formatDate(timelineItem.created_at) : 'Pending'}</small>
            </div>
          )
        })}
      </div>
      {!['credited', 'completed', 'rejected'].includes(request.status) && (
        <p className="resolution-estimate">
          Estimated resolution by <strong>{formatDate(estimatedResolution.toISOString())}</strong>. This may change if additional verification is required.
        </p>
      )}
      <dl>
        <div>
          <dt>Product</dt>
          <dd>{request.product_name}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            {Number(request.amount_requested) > 0
              ? `$${Number(request.amount_requested).toFixed(2)}`
              : Number(request.customer_requested_amount) > 0
                ? `$${Number(request.customer_requested_amount).toFixed(2)} requested`
                : 'Pending verification'}
          </dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>
            {request.preferred_payment_method === 'Pending staff verification' && request.customer_preferred_payment_method
              ? `${request.customer_preferred_payment_method} requested`
              : request.preferred_payment_method}
          </dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDate(request.created_at)}</dd>
        </div>
      </dl>
      {onOpenDocument && (
        <DocumentList
          documents={documents}
          loadingId={documentLoadingId}
          onOpen={onOpenDocument}
        />
      )}
      {orderedTimeline.length > 0 && (
        <div className="customer-status-timeline">
          <span>Status timeline</span>
          {orderedTimeline.map((item) => (
            <div key={item.id}>
              <strong>{formatStatus(item.to_status)}</strong>
              <small>{formatDate(item.created_at)}</small>
              {item.internal_notes && <p>{item.internal_notes}</p>}
            </div>
          ))}
        </div>
      )}
      {(onCancel || onDownloadReceipt) && (
        <div className="request-summary-actions">
          {onDownloadReceipt && (
            <button className="secondary-button" onClick={onDownloadReceipt} type="button">
              Download PDF receipt
            </button>
          )}
          {onCancel && (
            <button className="danger-button" onClick={onCancel} type="button">
              Cancel request
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function CustomerFilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const previewUrl = useMemo(
    () => file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
    [file],
  )

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  return (
    <article>
      {previewUrl ? <img alt={`Preview of ${file.name}`} src={previewUrl} /> : <span aria-hidden="true">PDF</span>}
      <div><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></div>
      <button aria-label={`Remove ${file.name}`} onClick={onRemove} title="Remove file" type="button">X</button>
    </article>
  )
}

function NotFoundPage({ onReturn }: { onReturn: () => void }) {
  return (
    <main className="not-found-page">
      <section>
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p>The page you requested is not part of the refund portal.</p>
        <button onClick={onReturn} type="button">Return to the portal</button>
      </section>
    </main>
  )
}

function DocumentList({
  documents,
  loadingId,
  onOpen,
}: {
  documents: RefundDocumentRow[]
  loadingId: string
  onOpen: (document: RefundDocumentRow) => void | Promise<void>
}) {
  return (
    <div className="secure-document-list">
      <span>Supporting documents</span>
      {documents.length === 0 ? (
        <p>No documents uploaded.</p>
      ) : (
        documents.map((document) => (
          <div key={document.id}>
            <div>
              <strong>{document.document_type}</strong>
              <small>{formatFileSize(document.file_size_bytes)}</small>
            </div>
            <button
              disabled={loadingId === document.id}
              onClick={() => void onOpen(document)}
              type="button"
            >
              {loadingId === document.id ? 'Opening...' : 'Open'}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function getAllowedViews(role?: UserRole): PortalView[] {
  if (role === 'administrator') return ['customer', 'manager', 'admin', 'bank']
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
  const terminalStatuses: RefundStatus[] = ['rejected', 'payment_processing', 'credited', 'completed']

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

  const requiredStatus: Record<ManagerWorkflowTarget, RefundStatus> = {
    under_review: 'submitted',
    documents_verified: 'under_review',
    approved: 'documents_verified',
  }

  if (currentStatus !== requiredStatus[target]) {
    return {
      disabled: true,
      reason: `${formatStatus(target)} becomes available after ${formatStatus(requiredStatus[target])}.`,
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

function escapeCsvCell(value: unknown) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function getAntivirusOption(productName: string | null | undefined) {
  return (
    antivirusOptions.find((option) => option.label.toLowerCase() === productName?.toLowerCase()) ??
    antivirusOptions[0]
  )
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
  } else if (event.action === 'user_account_created') {
    detail = `${actor} created ${target} as ${formatAuditValue(
      readMetadataString(metadata, 'targetRole'),
    )}. Email verification is pending.`
  } else if (event.action === 'user_mfa_updated') {
    detail = `${actor} changed ${target}'s MFA requirement from ${formatAuditValue(from)} to ${formatAuditValue(to)}.`
  } else if (event.action === 'user_account_deleted') {
    detail = `${actor} deleted ${target} from the portal.`
  } else if (event.action === 'refund_status_changed') {
    detail = `${actor} moved refund ${reference || event.entity_id || 'request'} from ${formatAuditValue(
      from,
    )} to ${formatAuditValue(to)}.`
  } else if (event.action === 'refund_product_updated') {
    detail = `${actor} changed refund ${reference || event.entity_id || 'request'} product from ${formatAuditValue(
      from,
    )} to ${formatAuditValue(to)}.`
  } else if (event.action === 'payment_status_updated') {
    detail = `${actor} updated payment ${transaction || event.entity_id || 'transaction'} from ${formatAuditValue(
      from,
    )} to ${formatAuditValue(to)}.`
  } else if (event.action === 'refund_report_exported') {
    const format = (readMetadataString(metadata, 'format') || 'CSV').toUpperCase()
    const total = Number(readMetadataString(metadata, 'totalAmount') || 0)
    detail = `${actor} exported ${readMetadataString(metadata, 'count') || '0'} refund records as ${format} totaling $${total.toFixed(2)}.`
  } else if (event.action === 'internal_note_added') {
    detail = `${actor} added an internal note to refund ${reference || event.entity_id || 'request'}.`
  } else if (event.action === 'refund_submitted') {
    detail = `${actor} submitted refund ${reference || event.entity_id || 'request'}.`
  } else if (event.action === 'refund_request_cancelled') {
    detail = `${actor} cancelled and permanently removed a submitted refund request.`
  } else if (event.action === 'staff_refund_submitted') {
    detail = `${actor} created refund ${reference || event.entity_id || 'request'} for ${readMetadataString(
      metadata,
      'customerName',
    ) || readMetadataString(metadata, 'customerEmail') || 'a customer'}.`
  } else if (event.action === 'notification_queued') {
    detail = `${actor} queued ${readMetadataString(metadata, 'provider') || 'email'} notification for refund ${
      reference || 'request'
    }.`
  } else if (event.action === 'documents_requested') {
    detail = `${actor} requested additional customer documents for refund ${
      reference || event.entity_id || 'request'
    }: ${readMetadataString(metadata, 'requestedDocuments') || 'Details recorded in the request.'}`
  } else if (event.action === 'document_link_created') {
    detail = `${actor} generated a time-limited link for ${
      readMetadataString(metadata, 'documentType') || 'a supporting document'
    } on refund ${reference || readMetadataString(metadata, 'refundRequestId') || 'request'}.`
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

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
