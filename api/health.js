import { createClient } from '@supabase/supabase-js'
import {
  captureServerException,
  getSafeServerErrorMessage,
  isServerMonitoringEnabled,
  withServerMonitoring,
} from '../server/monitoring.js'

async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)

  if (!supabaseUrl || !serviceRoleKey) {
    response.status(503).json({
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
      components: {
        database: 'unconfigured',
        email: resendConfigured ? 'configured' : 'unconfigured',
        monitoring: isServerMonitoringEnabled ? 'configured' : 'unconfigured',
      },
    })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { error } = await supabase.from('roles').select('id').limit(1)

  if (error) {
    await captureServerException(error, { operation: 'database_health_check', route: 'health' })
    console.error('Health check database query failed.', { error: getSafeServerErrorMessage(error) })
    response.status(503).json({
      status: 'degraded',
      checkedAt: new Date().toISOString(),
      components: {
        database: 'unavailable',
        email: resendConfigured ? 'configured' : 'unconfigured',
        monitoring: isServerMonitoringEnabled ? 'configured' : 'unconfigured',
      },
    })
    return
  }

  response.status(200).json({
    status: resendConfigured ? 'healthy' : 'degraded',
    checkedAt: new Date().toISOString(),
    components: {
      database: 'available',
      email: resendConfigured ? 'configured' : 'unconfigured',
      monitoring: isServerMonitoringEnabled ? 'configured' : 'unconfigured',
    },
  })
}

export default withServerMonitoring(handler, 'health')
