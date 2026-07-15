import { createHash } from 'node:crypto'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getBearerToken(request) {
  const authorization = request.headers.authorization
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
}

export function getValidUuid(value) {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null
}

export function getJsonBody(request) {
  try {
    return typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {})
  } catch {
    return {}
  }
}

export async function authenticatePortalUser(supabase, bearerToken) {
  if (!bearerToken) return null

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(bearerToken)

  if (authError || !user) return null

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .maybeSingle()

  return profileError || !profile ? null : profile
}

export async function consumeRateLimit(supabase, request, scope, limit, windowSeconds = 60) {
  const forwarded = request.headers['x-forwarded-for']
  const address = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket?.remoteAddress
  const fingerprint = createHash('sha256')
    .update(address || 'unknown')
    .digest('hex')
    .slice(0, 32)
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_key: `${scope}:${fingerprint}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })

  if (error) throw error
  return data === true
}
