import { createClient } from '@supabase/supabase-js'

const maxBatchSize = 10
const refundIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST')
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const resendFromEmail = process.env.RESEND_FROM_EMAIL

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !resendFromEmail) {
    response.status(500).json({
      error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, or RESEND_FROM_EMAIL.',
    })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  })

  const cronSecret = process.env.NOTIFICATION_CRON_SECRET ?? process.env.CRON_SECRET
  const authorization = request.headers.authorization
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
  const requestedRefundId = getRequestedRefundId(request)
  const hasValidSecret = Boolean(
    cronSecret &&
      (request.headers['x-notification-secret'] === cronSecret || bearerToken === cronSecret),
  )

  if (!hasValidSecret) {
    if (!bearerToken) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(bearerToken)

    if (authError || !user) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !userProfile) {
      response.status(403).json({ error: 'Portal access required' })
      return
    }

    const isStaff = ['administrator', 'refund_manager'].includes(userProfile.role)

    if (!isStaff) {
      if (!requestedRefundId) {
        response.status(403).json({ error: 'A valid refund request is required' })
        return
      }

      const { data: ownedRequest, error: ownershipError } = await supabase
        .from('refund_requests')
        .select('id')
        .eq('id', requestedRefundId)
        .eq('created_by', user.id)
        .maybeSingle()

      if (ownershipError || !ownedRequest) {
        response.status(403).json({ error: 'Refund request access denied' })
        return
      }
    }
  }

  const now = new Date().toISOString()
  let notificationQuery = supabase
    .from('notifications')
    .select(
      'id, refund_request_id, recipient, subject, body, attempt_count, max_attempts, refund_requests(reference_number, order_number, product_name)',
    )
    .eq('channel', 'email')
    .in('status', ['queued', 'retry'])
    .lte('next_attempt_at', now)
    .order('created_at', { ascending: true })
    .limit(maxBatchSize)

  if (requestedRefundId) {
    notificationQuery = notificationQuery.eq('refund_request_id', requestedRefundId)
  }

  const { data: notifications, error } = await notificationQuery

  if (error) {
    response.status(500).json({ error: error.message })
    return
  }

  const dueNotifications = (notifications ?? []).filter(
    (notification) => notification.attempt_count < notification.max_attempts,
  )
  const results = []

  for (const notification of dueNotifications) {
    const nextAttemptCount = notification.attempt_count + 1

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFromEmail,
          to: [notification.recipient],
          subject: notification.subject,
          text: notification.body,
          html: buildEmailHtml(notification, request),
        }),
      })
      const providerResponse = await resendResponse.json().catch(() => ({}))

      if (!resendResponse.ok) {
        throw new Error(providerResponse?.message ?? `Resend responded with ${resendResponse.status}.`)
      }

      await supabase
        .from('notifications')
        .update({
          attempt_count: nextAttemptCount,
          last_attempt_at: new Date().toISOString(),
          last_error: null,
          provider_message_id: providerResponse.id ?? null,
          provider_response: providerResponse,
          sent_at: new Date().toISOString(),
          status: 'sent',
        })
        .eq('id', notification.id)

      results.push({ id: notification.id, status: 'sent' })
    } catch (sendError) {
      const isFinalAttempt = nextAttemptCount >= notification.max_attempts
      const retryDelayMinutes = Math.min(60, 5 * nextAttemptCount * nextAttemptCount)

      await supabase
        .from('notifications')
        .update({
          attempt_count: nextAttemptCount,
          last_attempt_at: new Date().toISOString(),
          last_error: sendError instanceof Error ? sendError.message : 'Email delivery failed.',
          next_attempt_at: new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString(),
          status: isFinalAttempt ? 'failed' : 'retry',
        })
        .eq('id', notification.id)

      results.push({ id: notification.id, status: isFinalAttempt ? 'failed' : 'retry' })
    }
  }

  response.status(200).json({
    processed: results.length,
    results,
  })
}

function getRequestedRefundId(request) {
  if (request.method !== 'POST') return null

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const refundRequestId = body?.refundRequestId
    return typeof refundRequestId === 'string' && refundIdPattern.test(refundRequestId)
      ? refundRequestId
      : null
  } catch {
    return null
  }
}

function buildEmailHtml(notification, request) {
  const refund = Array.isArray(notification.refund_requests)
    ? notification.refund_requests[0]
    : notification.refund_requests
  const productName = refund?.product_name ?? 'Refund'
  const branding = getEmailBranding(productName)
  const forwardedProtocol = request.headers['x-forwarded-proto']
  const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol.split(',')[0] : 'https'
  const host = request.headers.host
  const iconUrl = host ? `${protocol}://${host}${branding.icon}` : null
  const bodyHtml = escapeHtml(notification.body ?? '').replaceAll('\n', '<br>')

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f7fb;color:#111827;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dbe3ef;border-radius:8px;overflow:hidden;">
          <tr><td style="height:5px;background:${branding.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:26px 30px 12px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
              <td style="vertical-align:middle;">${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" width="38" height="38" style="display:block;object-fit:contain;">` : ''}</td>
              <td style="padding-left:12px;vertical-align:middle;font-size:18px;font-weight:700;">${escapeHtml(productName)} Refund Processing</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:12px 30px 8px;font-size:22px;font-weight:700;line-height:1.3;">${escapeHtml(notification.subject ?? 'Refund update')}</td></tr>
          <tr><td style="padding:10px 30px 28px;font-size:15px;line-height:1.65;color:#374151;">${bodyHtml}</td></tr>
          <tr><td style="border-top:1px solid #e5e7eb;padding:16px 30px;font-size:12px;line-height:1.5;color:#6b7280;">
            Reference ${escapeHtml(refund?.reference_number ?? 'Unavailable')} &nbsp;|&nbsp; Order ${escapeHtml(refund?.order_number ?? 'Unavailable')}<br>
            This is an automated service notification. Please keep this email for your records.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function getEmailBranding(productName) {
  const brands = {
    mcafee: { accent: '#b91c1c', icon: '/mcafee-icon.png' },
    norton: { accent: '#f7b500', icon: '/norton-icon.png' },
    avast: { accent: '#f97316', icon: '/avast-icon.png' },
    malwarebytes: { accent: '#1646d8', icon: '/malwarebytes-icon.png' },
    totalav: { accent: '#0f766e', icon: '/totalav-icon.png' },
  }

  return brands[String(productName).toLowerCase()] ?? { accent: '#334155', icon: '/favicon.svg' }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
