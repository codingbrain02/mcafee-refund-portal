import { createClient } from '@supabase/supabase-js'
import {
  authenticatePortalUser,
  consumeRateLimit,
  getBearerToken,
  getJsonBody,
  getValidUuid,
} from '../server/security.js'

const headAdministratorEmail = 'jccodingbrain@gmail.com'

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Account deletion configuration is incomplete.')
    response.status(500).json({ error: 'Account deletion is temporarily unavailable' })
    return
  }

  const bearerToken = getBearerToken(request)
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearerToken ?? ''}` } },
  })

  try {
    const profile = await authenticatePortalUser(service, bearerToken)
    if (!profile) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (
      profile.role !== 'administrator' ||
      profile.email?.trim().toLowerCase() !== headAdministratorEmail
    ) {
      response.status(403).json({ error: 'Only the portal administrator can delete user accounts' })
      return
    }

    const withinLimit = await consumeRateLimit(service, request, `delete-user:${profile.id}`, 10, 300)
    if (!withinLimit) {
      response.setHeader('Retry-After', '300')
      response.status(429).json({ error: 'Too many account deletion attempts. Try again later.' })
      return
    }

    const body = getJsonBody(request)
    const targetUserId = getValidUuid(body.targetUserId)
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation : ''

    if (!targetUserId || confirmation !== 'Delete user account') {
      response.status(400).json({ error: 'The deletion confirmation is invalid' })
      return
    }

    if (targetUserId === profile.id) {
      response.status(400).json({ error: 'You cannot delete the account for the active session' })
      return
    }

    const { data: paths, error: pathError } = await service.rpc('get_user_deletion_document_paths', {
      target_user_id: targetUserId,
    })
    if (pathError) throw pathError

    const storagePaths = [...new Set((paths ?? []).map((item) => item.storage_path).filter(Boolean))]
    for (let index = 0; index < storagePaths.length; index += 100) {
      const { error: storageError } = await service.storage
        .from('refund-documents')
        .remove(storagePaths.slice(index, index + 100))
      if (storageError) throw storageError
    }

    const { error: deletionError } = await userClient.rpc('delete_user_account', {
      confirmation,
      target_user_id: targetUserId,
    })
    if (deletionError) throw deletionError

    response.status(200).json({ deleted: true })
  } catch (error) {
    console.error('User account deletion failed.', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    response.status(503).json({
      error: 'The account and its related records could not be deleted. No partial database deletion was committed.',
    })
  }
}
