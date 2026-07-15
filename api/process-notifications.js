import { createClient } from '@supabase/supabase-js'

const maxBatchSize = 10

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

    const { data: staffProfile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (
      profileError ||
      !staffProfile ||
      !['administrator', 'refund_manager'].includes(staffProfile.role)
    ) {
      response.status(403).json({ error: 'Staff access required' })
      return
    }
  }

  const now = new Date().toISOString()
  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('id, recipient, subject, body, attempt_count, max_attempts')
    .eq('channel', 'email')
    .in('status', ['queued', 'retry'])
    .lte('next_attempt_at', now)
    .order('created_at', { ascending: true })
    .limit(maxBatchSize)

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
