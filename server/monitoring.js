import * as Sentry from '@sentry/node'
import {
  parseMonitoringSampleRate,
  scrubMonitoringData,
  scrubMonitoringText,
} from '../shared/monitoring-scrub.js'

const dsn = process.env.SENTRY_DSN?.trim()
const release = process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA

export const isServerMonitoringEnabled = Boolean(dsn)

if (dsn) {
  Sentry.init({
    beforeSend(event) {
      return scrubMonitoringData(event)
    },
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    maxValueLength: 500,
    release: release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: parseMonitoringSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
  })
}

export async function captureServerException(error, context = {}) {
  if (!isServerMonitoringEnabled) return

  const normalizedError = new Error(
    scrubMonitoringText(error instanceof Error ? error.message : error?.message ?? 'Unknown server error'),
  )
  if (error instanceof Error && error.stack) {
    normalizedError.stack = scrubMonitoringText(error.stack)
  }

  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setContext('portal', scrubMonitoringData(context))
    Sentry.captureException(normalizedError)
  })
  await Sentry.flush(1500)
}

export async function captureServerMessage(message, context = {}) {
  if (!isServerMonitoringEnabled) return

  Sentry.withScope((scope) => {
    scope.setLevel('warning')
    scope.setContext('portal', scrubMonitoringData(context))
    Sentry.captureMessage(scrubMonitoringText(message))
  })
  await Sentry.flush(1500)
}

export function getSafeServerErrorMessage(error) {
  return scrubMonitoringText(error instanceof Error ? error.message : error?.message ?? 'Unknown error')
}

export function withServerMonitoring(handler, route) {
  return async function monitoredHandler(request, response) {
    try {
      return await handler(request, response)
    } catch (error) {
      await captureServerException(error, { operation: 'unhandled_request', route })
      console.error('Unhandled serverless request error.', {
        error: getSafeServerErrorMessage(error),
        route,
      })

      if (!response.headersSent) {
        response.status(500).json({ error: 'The requested operation is temporarily unavailable' })
      }
    }
  }
}
