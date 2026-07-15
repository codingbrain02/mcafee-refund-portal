import { createClient } from '@supabase/supabase-js'
import {
  authenticatePortalUser,
  consumeRateLimit,
  getBearerToken,
  getJsonBody,
  getValidUuid,
} from '../server/security.js'
import {
  captureServerException,
  captureServerMessage,
  getSafeServerErrorMessage,
  withServerMonitoring,
} from '../server/monitoring.js'

const linkLifetimeSeconds = 300

async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    await captureServerMessage('Document link configuration is incomplete.', {
      operation: 'configuration_check',
      route: 'document-link',
    })
    console.error('Document link configuration is incomplete.')
    response.status(500).json({ error: 'Document access is temporarily unavailable' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  try {
    const withinLimit = await consumeRateLimit(supabase, request, 'document-link', 30)
    if (!withinLimit) {
      response.setHeader('Retry-After', '60')
      response.status(429).json({ error: 'Too many document requests. Try again shortly.' })
      return
    }

    const profile = await authenticatePortalUser(supabase, getBearerToken(request))
    if (!profile) {
      response.status(401).json({ error: 'Unauthorized' })
      return
    }

    const documentId = getValidUuid(getJsonBody(request).documentId)
    if (!documentId) {
      response.status(400).json({ error: 'A valid document is required' })
      return
    }

    const { data: document, error: documentError } = await supabase
      .from('refund_documents')
      .select(
        'id, refund_request_id, document_type, storage_path, refund_requests(created_by, reference_number, customers(email))',
      )
      .eq('id', documentId)
      .maybeSingle()

    if (documentError || !document) {
      response.status(404).json({ error: 'Document not found' })
      return
    }

    const refund = Array.isArray(document.refund_requests)
      ? document.refund_requests[0]
      : document.refund_requests
    const customer = Array.isArray(refund?.customers) ? refund.customers[0] : refund?.customers
    const isStaff = ['administrator', 'refund_manager'].includes(profile.role)
    const isOwner =
      refund?.created_by === profile.id ||
      Boolean(customer?.email && customer.email.toLowerCase() === profile.email.toLowerCase())

    if (!isStaff && !isOwner) {
      response.status(403).json({ error: 'Document access denied' })
      return
    }

    const { data: signedLink, error: signedLinkError } = await supabase.storage
      .from('refund-documents')
      .createSignedUrl(document.storage_path, linkLifetimeSeconds, { download: document.document_type })

    if (signedLinkError || !signedLink?.signedUrl) {
      await captureServerException(signedLinkError ?? new Error('Signed link was not returned.'), {
        operation: 'create_signed_document_link',
        route: 'document-link',
      })
      console.error('Failed to create document link.', {
        documentId,
        error: getSafeServerErrorMessage(signedLinkError),
      })
      response.status(500).json({ error: 'A secure document link could not be created' })
      return
    }

    await supabase.from('audit_logs').insert({
      actor_id: profile.id,
      action: 'document_link_created',
      entity_type: 'refund_document',
      entity_id: document.id,
      metadata: {
        actorEmail: profile.email,
        actorName: profile.full_name,
        documentType: document.document_type,
        expiresInSeconds: linkLifetimeSeconds,
        recordedAt: new Date().toISOString(),
        referenceNumber: refund?.reference_number,
        refundRequestId: document.refund_request_id,
      },
    })

    response.status(200).json({
      expiresIn: linkLifetimeSeconds,
      url: signedLink.signedUrl,
    })
  } catch (error) {
    await captureServerException(error, { operation: 'document_link_request', route: 'document-link' })
    console.error('Document link request failed.', {
      error: getSafeServerErrorMessage(error),
    })
    response.status(503).json({ error: 'Document access is temporarily unavailable' })
  }
}

export default withServerMonitoring(handler, 'document-link')
