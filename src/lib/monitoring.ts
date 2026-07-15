import * as Sentry from '@sentry/react'
import {
  parseMonitoringSampleRate,
  scrubMonitoringData,
  scrubMonitoringText,
} from '../../shared/monitoring-scrub.js'

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
const release = import.meta.env.VITE_APP_RELEASE?.trim()

export const isMonitoringEnabled = Boolean(dsn)

export function initializeMonitoring() {
  if (!dsn) return

  Sentry.init({
    beforeBreadcrumb(breadcrumb) {
      return scrubMonitoringData(breadcrumb) as typeof breadcrumb
    },
    beforeSend(event) {
      return scrubMonitoringData(event) as typeof event
    },
    dsn,
    environment: import.meta.env.MODE,
    maxValueLength: 500,
    release: release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: parseMonitoringSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0),
  })
}

export function capturePortalException(
  error: unknown,
  context: Record<string, unknown> = {},
) {
  if (!isMonitoringEnabled) return

  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setContext('portal', scrubMonitoringData(context) as Record<string, unknown>)
    Sentry.captureException(error instanceof Error ? error : new Error('Unknown portal error'))
  })
}

export function getSafePortalErrorMessage(error: unknown) {
  return scrubMonitoringText(error instanceof Error ? error.message : 'Unknown portal error')
}
