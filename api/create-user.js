import { createClient } from '@supabase/supabase-js'
import {
  authenticatePortalUser,
  canCreatePortalRole,
  consumeRateLimit,
  getBearerToken,
  getJsonBody,
} from '../server/security.js'

const allowedRoles = new Set(['customer', 'refund_manager', 'administrator'])
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
    console.error('Staff account creation configuration is incomplete.')
    response.status(500).json({ error: 'Account creation is temporarily unavailable' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signupClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const profile = await authenticatePortalUser(supabase, getBearerToken(request))
    if (!profile) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const withinLimit = await consumeRateLimit(supabase, request, `create-user:${profile.id}`, 10, 300)
    if (!withinLimit) {
      response.setHeader('Retry-After', '300')
      response.status(429).json({ error: 'Too many account creation attempts. Try again later.' })
      return
    }

    const body = getJsonBody(request)
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const role = typeof body.role === 'string' ? body.role : ''

    if (!fullName || fullName.length > 120) {
      response.status(400).json({ error: 'Enter a valid full name' })
      return
    }

    if (!emailPattern.test(email) || email.length > 254) {
      response.status(400).json({ error: 'Enter a valid email address' })
      return
    }

    if (password.length < 8 || password.length > 72) {
      response.status(400).json({ error: 'The temporary password must contain 8 to 72 characters' })
      return
    }

    if (!allowedRoles.has(role) || !canCreatePortalRole(profile, role)) {
      response.status(403).json({ error: 'You are not authorized to create an account with this role' })
      return
    }

    const { data: signupData, error: signupError } = await signupClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: getApplicationOrigin(request),
      },
    })

    const createdUser = signupData?.user
    const duplicateAccount = createdUser?.identities?.length === 0

    if (signupError || !createdUser || duplicateAccount) {
      const duplicate = duplicateAccount || signupError?.message?.toLowerCase().includes('already')
      response.status(duplicate ? 409 : 400).json({
        error: duplicate
          ? 'An account already exists for this email address'
          : 'The account could not be created',
      })
      return
    }

    const { error: profileError } = await supabase
      .from('users')
      .update({ full_name: fullName, role, updated_at: new Date().toISOString() })
      .eq('id', createdUser.id)

    if (profileError) {
      await supabase.auth.admin.deleteUser(createdUser.id)
      throw new Error(`Account profile creation failed: ${profileError.message}`)
    }

    await supabase.from('audit_logs').insert({
      actor_id: profile.id,
      action: 'user_account_created',
      entity_type: 'user',
      entity_id: createdUser.id,
      metadata: {
        actorEmail: profile.email,
        actorName: profile.full_name,
        recordedAt: new Date().toISOString(),
        targetEmail: email,
        targetName: fullName,
        targetRole: role,
        verificationStatus: 'pending',
      },
    })

    response.status(201).json({
      message: `A verification email was sent to ${email}.`,
      userId: createdUser.id,
    })
  } catch (error) {
    console.error('Staff account creation failed.', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    response.status(503).json({ error: 'The account could not be created. Please try again.' })
  }
}

function getApplicationOrigin(request) {
  const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : ''

  try {
    const origin = new URL(requestOrigin)
    if (origin.protocol === 'https:' || origin.hostname === 'localhost') return origin.origin
  } catch {
    // Fall through to the deployment URL.
  }

  const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  return deploymentHost ? `https://${deploymentHost}` : 'http://localhost:3000'
}
