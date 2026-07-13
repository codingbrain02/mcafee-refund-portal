import { useMemo, useState } from 'react'
import './App.css'

type PortalView = 'customer' | 'manager' | 'admin' | 'bank'

const workflow = [
  'Customer Submitted',
  'Document Verification',
  'Manager Review',
  'Approval',
  'Bank Payment Processing',
  'Completed',
]

const managerStats = [
  ['New Refund Requests', '18'],
  ['Pending Verification', '9'],
  ['Approved Refunds', '31'],
  ['Declined Requests', '4'],
]

const queue = [
  {
    id: 'RF-10942',
    customer: 'Maya Chen',
    order: 'ORD-78124',
    amount: '$248.00',
    status: 'Under Review',
    owner: 'EMP-204',
  },
  {
    id: 'RF-10941',
    customer: 'Jordan Miles',
    order: 'ORD-78098',
    amount: '$79.50',
    status: 'Documents Verified',
    owner: 'EMP-118',
  },
  {
    id: 'RF-10940',
    customer: 'Ari Patel',
    order: 'ORD-78021',
    amount: '$1,120.00',
    status: 'Payment Processing',
    owner: 'EMP-204',
  },
]

const auditEvents = [
  'EMP-204 approved refund RF-10940',
  'EMP-118 uploaded verification note for RF-10941',
  'ADMIN-001 changed SMS notification setting',
  'EMP-204 exported refund report',
]

function App() {
  const [view, setView] = useState<PortalView>('manager')
  const [refundAmount, setRefundAmount] = useState('248.00')
  const [otpEnabled, setOtpEnabled] = useState(true)

  const paymentEta = useMemo(() => {
    const amount = Number(refundAmount) || 0
    return amount > 1000 ? 'Manual bank review required' : '2 business days'
  }, [refundAmount])

  return (
    <main className="app-shell">
      <section className="login-panel" aria-label="Secure employee login">
        <div className="brand-lockup">
          <span className="brand-mark">M</span>
          <div>
            <strong>McAfee Refund Processing Portal</strong>
            <small>For authorized customer refund operations</small>
          </div>
        </div>

        <form className="login-card">
          <label>
            Username
            <input autoComplete="username" defaultValue="refund.manager" />
          </label>
          <label>
            Password
            <input autoComplete="current-password" type="password" />
          </label>
          <label>
            Two-factor authentication (OTP)
            <input inputMode="numeric" placeholder="6-digit code" />
          </label>
          <button type="button">Sign in</button>
          <a href="#reset">Forgot Password</a>
        </form>
      </section>

      <section className="portal-panel">
        <header className="portal-header">
          <div>
            <p className="eyebrow">Secure refund operations</p>
            <h1>Refund Management Portal</h1>
          </div>
          <div className="security-strip">
            <span>JWT sessions</span>
            <span>Role-based access</span>
            <span>TLS 1.3 ready</span>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Portal sections">
          {(['customer', 'manager', 'admin', 'bank'] as const).map((tab) => (
            <button
              className={view === tab ? 'active' : ''}
              key={tab}
              onClick={() => setView(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </nav>

        {view === 'customer' && (
          <section className="content-grid">
            <form className="work-card form-grid">
              <div className="section-heading">
                <p className="eyebrow">Customer refund form</p>
                <h2>Submit request</h2>
              </div>
              <label>
                Full Name
                <input defaultValue="Maya Chen" />
              </label>
              <label>
                Email Address
                <input defaultValue="maya.chen@example.com" type="email" />
              </label>
              <label>
                Phone Number
                <input defaultValue="+1 555 0184" type="tel" />
              </label>
              <label>
                Refund Reference Number
                <input defaultValue="RF-10942" />
              </label>
              <label>
                Order Number
                <input defaultValue="ORD-78124" />
              </label>
              <label>
                Purchase Date
                <input defaultValue="2026-07-09" type="date" />
              </label>
              <label>
                Reason for Cancellation
                <select defaultValue="Duplicate charge">
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
                  onChange={(event) => setRefundAmount(event.target.value)}
                  step="0.01"
                  type="number"
                  value={refundAmount}
                />
              </label>
              <label>
                Preferred Refund Method
                <select defaultValue="Original payment method">
                  <option>Original payment method</option>
                  <option>Bank transfer</option>
                  <option>Store credit</option>
                </select>
              </label>
              <label>
                Upload Documents
                <input accept=".pdf,.jpg,.jpeg,.png" multiple type="file" />
              </label>
              <div className="document-checklist">
                <span>Government ID</span>
                <span>Purchase Receipt</span>
                <span>Cancellation Proof</span>
              </div>
              <button className="primary-action" type="button">
                Submit refund request
              </button>
            </form>

            <WorkflowCard />
          </section>
        )}

        {view === 'manager' && (
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
                  <input className="search-input" placeholder="Search Customers" />
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
                      {queue.map((request) => (
                        <tr key={request.id}>
                          <td>{request.id}</td>
                          <td>{request.customer}</td>
                          <td>{request.order}</td>
                          <td>{request.amount}</td>
                          <td>
                            <span className="status-pill">{request.status}</span>
                          </td>
                          <td>{request.owner}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="button-row">
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
                <textarea defaultValue="Receipt matches payment gateway transaction. Awaiting ID verification before approval." />
                <WorkflowCard compact />
              </aside>
            </div>
          </section>
        )}

        {view === 'admin' && (
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
            </aside>
          </section>
        )}

        {view === 'bank' && (
          <section className="content-grid">
            <section className="work-card form-grid">
              <div className="section-heading full-span">
                <p className="eyebrow">Bank processing interface</p>
                <h2>Authorized payment request</h2>
              </div>
              <label>
                Beneficiary Name
                <input defaultValue="Maya Chen" />
              </label>
              <label>
                Transaction Reference
                <input defaultValue="PAY-RF-10942" />
              </label>
              <label>
                Payment Amount
                <input defaultValue={refundAmount} readOnly />
              </label>
              <label>
                Payment Status
                <select defaultValue="Queued">
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
          <div className={index < 3 ? 'complete' : ''} key={step}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
    </aside>
  )
}

export default App
