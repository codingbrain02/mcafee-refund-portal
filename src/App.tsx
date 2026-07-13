import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  hasSupabaseConfig,
  supabase,
  type RefundRequestRow,
  type UserProfile,
  type UserRole,
} from './lib/supabase'
import './App.css'

type PortalView = 'customer' | 'manager' | 'admin' | 'bank'
type AuthMode = 'sign-in' | 'sign-up'
type NoticeKind = 'info' | 'success' | 'error'

type Notice = {
  kind: NoticeKind
  message: string
}

const workflow = [
  'Customer Submitted',
  'Document Verification',
  'Manager Review',
  'Approval',
  'Bank Payment Processing',
  'Completed',
]

const auditEvents: string[] = []

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
  const [searchTerm, setSearchTerm] = useState('')

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

      const { data } = await auth.getSession()
      if (!isMounted) return
      if (isRecoveringPassword) return
      await loadProfile(data.session?.user.id ?? null)
    }

    const {
      data: { subscription },
    } = auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
        setProfile(null)
        setRequests([])
        setNotice({ kind: 'info', message: 'Create a new password to finish account recovery.' })
        return
      }

      void loadProfile(session?.user.id ?? null)
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
    }
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

  const paymentEta = useMemo(() => {
    const amount = Number(refundAmount) || 0
    if (!amount) return 'Awaiting amount'
    return amount > 1000 ? 'Manual bank review required' : '2 business days'
  }, [refundAmount])

  async function loadProfile(userId: string | null) {
    if (!supabase || !userId) {
      setProfile(null)
      setRequests([])
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
      setNotice({ kind: 'error', message: 'Sign in or create an account before submitting a refund.' })
      return
    }

    if (!fullName || !email || !referenceNumber || !orderNumber || !amount) {
      setNotice({ kind: 'error', message: 'Complete all required refund fields.' })
      return
    }

    setIsSubmittingRefund(true)

    const { data: userData } = await supabase.auth.getUser()
    const createdBy = userData.user?.id ?? null

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
      setNotice({ kind: 'error', message: customerError.message })
      return
    }

    const { data: refund, error: refundError } = await supabase
      .from('refund_requests')
      .insert({
        customer_id: customer.id,
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
      setNotice({ kind: 'error', message: refundError.message })
      return
    }

    for (const file of files) {
      if (file.size === 0) continue

      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        setNotice({ kind: 'error', message: `${file.name} must be PDF, JPG, or PNG.` })
        continue
      }

      if (file.size > 10 * 1024 * 1024) {
        setNotice({ kind: 'error', message: `${file.name} is larger than 10 MB.` })
        continue
      }

      const storagePath = `${refund.id}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('refund-documents')
        .upload(storagePath, file)

      if (uploadError) {
        setNotice({ kind: 'error', message: uploadError.message })
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
        setNotice({ kind: 'error', message: documentError.message })
      }
    }

    setIsSubmittingRefund(false)
    event.currentTarget.reset()
    setRefundAmount('')
    setNotice({
      kind: 'success',
      message: `Refund request ${referenceNumber} submitted.`,
    })
    await loadRefundRequests()
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
        ) : (
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
                  <button disabled={!profile} onClick={loadRefundRequests} type="button">
                    Refresh
                  </button>
                </div>
                {profile ? (
                  <div className="request-list">
                    {requests.map((request) => (
                      <article className="request-summary" key={request.id}>
                        <div>
                          <strong>{request.reference_number}</strong>
                          <span>{request.order_number}</span>
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
              <WorkflowCard compact />
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
                        <tr key={request.id}>
                          <td data-label="Request">{request.reference_number}</td>
                          <td data-label="Customer">{request.customers?.full_name ?? 'Unknown'}</td>
                          <td data-label="Order">{request.order_number}</td>
                          <td data-label="Amount">${Number(request.amount_requested).toFixed(2)}</td>
                          <td data-label="Status">
                            <span className="status-pill">{formatStatus(request.status)}</span>
                          </td>
                          <td data-label="Owner">{request.assigned_to ?? 'Unassigned'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredRequests.length === 0 && (
                    <p className="empty-state">No refund requests found.</p>
                  )}
                </div>
                <div className="button-row">
                  <button onClick={loadRefundRequests} type="button">
                    Refresh
                  </button>
                  <button type="button">Verify documents</button>
                  <button type="button">Approve</button>
                  <button type="button">Reject</button>
                  <button type="button">Export Reports</button>
                </div>
              </section>

              <aside className="work-card">
                <div className="section-heading">
                  <p className="eyebrow">Notes & internal comments</p>
                  <h2>Activity timeline</h2>
                </div>
                <textarea placeholder="No internal comments yet." />
                <WorkflowCard compact />
              </aside>
            </div>
          </section>
        )}

        {activeView === 'admin' && (
          <section className="content-grid">
            <section className="work-card admin-grid">
              <div className="section-heading full-span">
                <p className="eyebrow">Administrator dashboard</p>
                <h2>Controls</h2>
              </div>
              {[
                'User management',
                'Role management',
                'Permission management',
                'System configuration',
                'Notification settings',
                'Dashboard analytics',
              ].map((item) => (
                <button key={item} type="button">
                  {item}
                </button>
              ))}
            </section>

            <aside className="work-card">
              <div className="section-heading">
                <p className="eyebrow">Immutable audit log</p>
                <h2>Recent events</h2>
              </div>
              <ol className="audit-list">
                {auditEvents.map((event) => (
                  <li key={event}>{event}</li>
                ))}
              </ol>
              {auditEvents.length === 0 && (
                <p className="empty-state">No audit events yet.</p>
              )}
            </aside>
          </section>
        )}

        {activeView === 'bank' && (
          <section className="content-grid">
            <section className="work-card form-grid">
              <div className="section-heading full-span">
                <p className="eyebrow">Bank processing interface</p>
                <h2>Authorized payment request</h2>
              </div>
              <label>
                Beneficiary Name
                <input placeholder="Beneficiary name" />
              </label>
              <label>
                Transaction Reference
                <input placeholder="Transaction reference" />
              </label>
              <label>
                Payment Amount
                <input readOnly value={refundAmount} />
              </label>
              <label>
                Payment Status
                <select defaultValue="">
                  <option disabled value="">
                    Select status
                  </option>
                  <option>Queued</option>
                  <option>Submitted</option>
                  <option>Settled</option>
                  <option>Failed</option>
                </select>
              </label>
              <div className="document-checklist full-span">
                <span>Verify beneficiary information</span>
                <span>Create authorized banking API request</span>
                <span>Track payment status</span>
                <span>Generate confirmation receipt</span>
                <span>Maintain transaction logs</span>
              </div>
              <button className="primary-action" type="button">
                Submit authorized payment request
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
            </aside>
          </section>
        )}
      </section>
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
  if (role === 'administrator') return ['customer', 'manager', 'admin', 'bank']
  if (role === 'refund_manager') return ['customer', 'manager', 'bank']
  return ['customer']
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
