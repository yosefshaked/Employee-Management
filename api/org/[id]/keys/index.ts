import { json } from '../../../_shared/http'
import { getControlSupabaseConfig } from '../../../_shared/env'

type AzureContext = {
  bindingData?: Record<string, unknown>
  log?: {
    (...args: unknown[]): void
    info?: (...args: unknown[]) => void
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
  res?: unknown
}

type HttpRequest = {
  headers?: Record<string, string | undefined>
  params?: Record<string, string | undefined>
}

function logInfo(context: AzureContext, message: string, details?: Record<string, unknown>) {
  if (typeof context?.log?.info === 'function') {
    context.log.info(message, details)
    return
  }
  if (typeof context?.log === 'function') {
    context.log(message, details)
    return
  }
  console.log(message, details)
}

function logError(context: AzureContext, message: string, error: unknown) {
  if (typeof context?.log?.error === 'function') {
    context.log.error(message, error)
    return
  }
  if (typeof context?.log === 'function') {
    context.log(message, error)
    return
  }
  console.error(message, error)
}

function readHeader(req: HttpRequest, name: string) {
  const headers = req?.headers
  if (!headers) {
    return undefined
  }
  if (name in headers && typeof headers[name] === 'string') {
    return headers[name]
  }
  const lower = name.toLowerCase()
  if (lower in headers && typeof headers[lower] === 'string') {
    return headers[lower]
  }
  const upper = name.toUpperCase()
  if (upper in headers && typeof headers[upper] === 'string') {
    return headers[upper]
  }
  return undefined
}

function extractBearer(headerValue: string | undefined) {
  if (!headerValue) {
    return null
  }
  const trimmed = headerValue.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null
  }
  const token = trimmed.slice('bearer '.length).trim()
  return token || null
}

function normalizeOrgId(context: AzureContext, req: HttpRequest) {
  const bindingId = context?.bindingData?.id ?? context?.bindingData?.orgId
  const paramId = req?.params?.id ?? req?.params?.orgId
  const value = bindingId ?? paramId
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function safeParseJson(text: string) {
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default async function handler(context: AzureContext, req: HttpRequest) {
  const orgId = normalizeOrgId(context, req)
  const authHeader = readHeader(req, 'authorization')
  const supabaseAuthHeader = readHeader(req, 'x-supabase-authorization')
  const bearerToken = extractBearer(authHeader ?? supabaseAuthHeader ?? undefined)
  let finalStatus = 500

  try {
    if (!orgId) {
      finalStatus = 400
      context.res = json(400, { message: 'missing org id' })
      return
    }

    if (!bearerToken) {
      finalStatus = 401
      context.res = json(401, { message: 'missing bearer' })
      return
    }

    const { url, anonKey } = getControlSupabaseConfig()
    const normalizedUrl = url.replace(/\/+$/, '')
    const rpcResponse = await fetch(`${normalizedUrl}/rest/v1/rpc/get_org_public_keys`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ p_org_id: orgId }),
    })

    const rawText = await rpcResponse.text()
    const parsedBody = rawText ? safeParseJson(rawText) : null

    if (!rpcResponse.ok) {
      finalStatus = rpcResponse.status
      const body = isRecord(parsedBody) ? parsedBody : {}
      context.res = json(finalStatus, body)
      return
    }

    if (!isRecord(parsedBody)) {
      finalStatus = 404
      context.res = json(404, { message: 'org not found or no access' })
      return
    }

    const supabaseUrl = typeof parsedBody.supabase_url === 'string' ? parsedBody.supabase_url : null
    const anonKeyValue = typeof parsedBody.anon_key === 'string' ? parsedBody.anon_key : null

    if (!supabaseUrl || !anonKeyValue) {
      finalStatus = 404
      context.res = json(404, { message: 'org not found or no access' })
      return
    }

    finalStatus = 200
    context.res = json(200, {
      supabase_url: supabaseUrl,
      anon_key: anonKeyValue,
    })
  } catch (error) {
    finalStatus = 500
    context.res = json(500, { message: 'internal error' })
    logError(context, 'org keys handler failed', error)
  } finally {
    logInfo(context, 'org keys request', {
      orgId: orgId ?? null,
      hasBearer: Boolean(bearerToken),
      status: finalStatus,
    })
  }
}
