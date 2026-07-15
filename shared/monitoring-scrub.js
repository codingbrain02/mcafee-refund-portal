const redacted = '[Redacted]'
const sensitiveKeyPattern = /authorization|cookie|password|passwd|token|secret|api.?key|service.?role|email|phone|full.?name|recipient|beneficiary|bank|account|body|request|response|user|ip.?address/i
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const sensitiveQueryPattern = /([?&](?:access_token|refresh_token|token|code|signature)=)[^&#\s]+/gi
const inlineSecretPattern = /\b(password|token|secret|api[_ -]?key|authorization|cookie|account(?:_number)?)\s*[:=]\s*[^\s,;]+/gi
const phonePattern = /\+?\d(?:[\s().-]*\d){8,14}/g

export function scrubMonitoringData(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return scrubMonitoringText(value)
  if (typeof value !== 'object') return value
  if (depth >= 8) return '[Truncated]'
  if (seen.has(value)) return '[Circular]'

  seen.add(value)

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => scrubMonitoringData(item, depth + 1, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) ? redacted : scrubMonitoringData(item, depth + 1, seen),
    ]),
  )
}

export function scrubMonitoringText(value) {
  return String(value)
    .replace(bearerPattern, `Bearer ${redacted}`)
    .replace(jwtPattern, redacted)
    .replace(emailPattern, redacted)
    .replace(sensitiveQueryPattern, `$1${redacted}`)
    .replace(inlineSecretPattern, `$1=${redacted}`)
    .replace(phonePattern, redacted)
}

export function parseMonitoringSampleRate(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}
