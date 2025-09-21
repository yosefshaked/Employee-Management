import { createClient } from '@supabase/supabase-js'
import { json } from '../../_shared/http'
import { getControlSupabaseConfig, getControlSupabaseServiceRole } from '../../_shared/env'

type AzureContext = {
  log?: {
    (...args: unknown[]): void
    info?: (...args: unknown[]) => void
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
  res?: unknown
}

type HttpRequest = {
  headers?: unknown
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

function normalizeHeaderValue(rawValue: unknown): string | undefined {
  if (!rawValue) {
    return undefined
  }

  if (typeof rawValue === 'string') {
    return rawValue
  }

  if (Array.isArray(rawValue)) {
    for (const entry of rawValue) {
      const normalized = normalizeHeaderValue(entry)
      if (typeof normalized === 'string' && normalized.length > 0) {
        return normalized
      }
    }
    return undefined
  }

  if (typeof rawValue === 'object') {
    if (rawValue === null) {
      return undefined
    }

    if (typeof (rawValue as { value?: unknown }).value === 'string') {
      return (rawValue as { value: string }).value
    }

    const valueArray = (rawValue as { value?: unknown }).value
    if (Array.isArray(valueArray)) {
      const normalized = normalizeHeaderValue(valueArray)
      if (typeof normalized === 'string' && normalized.length > 0) {
        return normalized
      }
    }

    if (typeof (rawValue as { 0?: unknown })[0] === 'string') {
      return (rawValue as { 0: string })[0]
    }

    if (typeof (rawValue as { toString?: () => unknown }).toString === 'function'
      && (rawValue as { toString: () => unknown }).toString !== Object.prototype.toString) {
      const candidate = (rawValue as { toString: () => unknown }).toString()
      if (typeof candidate === 'string' && candidate && candidate !== '[object Object]') {
        return candidate
      }
    }

    if (typeof (rawValue as { [Symbol.iterator]?: () => Iterator<unknown> })[Symbol.iterator] === 'function') {
      for (const entry of rawValue as Iterable<unknown>) {
        const normalized = normalizeHeaderValue(entry)
        if (typeof normalized === 'string' && normalized.length > 0) {
          return normalized
        }
      }
    }
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue)
  }

  return undefined
}

function resolveHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers || !name) {
    return undefined
  }

  const targetName = name

  if (typeof (headers as { get?: (key: string) => unknown }).get === 'function') {
    const directValue = normalizeHeaderValue((headers as { get: (key: string) => unknown }).get(name))
    if (typeof directValue === 'string' && directValue.length > 0) {
      return directValue
    }

    const lowerValue = normalizeHeaderValue((headers as { get: (key: string) => unknown }).get(name.toLowerCase()))
    if (typeof lowerValue === 'string' && lowerValue.length > 0) {
      return lowerValue
    }
  }

  if (typeof headers === 'object' && headers !== null) {
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      const directValue = normalizeHeaderValue((headers as Record<string, unknown>)[name])
      if (typeof directValue === 'string' && directValue.length > 0) {
        return directValue
      }
    }

    const lowerName = name.toLowerCase()
    if (lowerName !== name && Object.prototype.hasOwnProperty.call(headers, lowerName)) {
      const lowerValue = normalizeHeaderValue((headers as Record<string, unknown>)[lowerName])
      if (typeof lowerValue === 'string' && lowerValue.length > 0) {
        return lowerValue
      }
    }

    const upperName = name.toUpperCase()
    if (upperName !== name && Object.prototype.hasOwnProperty.call(headers, upperName)) {
      const upperValue = normalizeHeaderValue((headers as Record<string, unknown>)[upperName])
      if (typeof upperValue === 'string' && upperValue.length > 0) {
        return upperValue
      }
    }
  }

  if (typeof (headers as { toJSON?: () => unknown }).toJSON === 'function') {
    const serialized = (headers as { toJSON: () => unknown }).toJSON()
    if (serialized && typeof serialized === 'object' && serialized !== null) {
      if (Object.prototype.hasOwnProperty.call(serialized, name)) {
        const directValue = normalizeHeaderValue((serialized as Record<string, unknown>)[name])
        if (typeof directValue === 'string' && directValue.length > 0) {
          return directValue
        }
      }

      const lowerName = name.toLowerCase()
      if (lowerName !== name && Object.prototype.hasOwnProperty.call(serialized, lowerName)) {
        const lowerValue = normalizeHeaderValue((serialized as Record<string, unknown>)[lowerName])
        if (typeof lowerValue === 'string' && lowerValue.length > 0) {
          return lowerValue
        }
      }

      const upperName = name.toUpperCase()
      if (upperName !== name && Object.prototype.hasOwnProperty.call(serialized, upperName)) {
        const upperValue = normalizeHeaderValue((serialized as Record<string, unknown>)[upperName])
        if (typeof upperValue === 'string' && upperValue.length > 0) {
          return upperValue
        }
      }
    }
  }

  const rawHeaders = (headers as { rawHeaders?: unknown })?.rawHeaders
  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index < rawHeaders.length - 1; index += 2) {
      const rawName = rawHeaders[index]
      if (typeof rawName !== 'string') {
        continue
      }

      if (rawName.toLowerCase() !== targetName.toLowerCase()) {
        continue
      }

      const rawValue = normalizeHeaderValue(rawHeaders[index + 1])
      if (typeof rawValue === 'string' && rawValue.length > 0) {
        return rawValue
      }
    }
  }

  const nestedHeaders = (headers as { headers?: unknown })?.headers
  if (nestedHeaders && nestedHeaders !== headers) {
    const nestedValue = resolveHeaderValue(nestedHeaders, name)
    if (nestedValue) {
      return nestedValue
    }
  }

  return undefined
}

function extractBearerToken(rawValue: unknown): string | null {
  const normalized = normalizeHeaderValue(rawValue)
  if (typeof normalized !== 'string') {
    return null
  }
  const trimmed = normalized.trim()
  if (!trimmed) {
    return null
  }
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null
  }
  const token = trimmed.slice('bearer '.length).trim()
  return token || null
}

export default async function handler(context: AzureContext, req: HttpRequest) {
  const headers = req?.headers
  const bearerToken = extractBearerToken(
    resolveHeaderValue(headers, 'authorization')
      ?? resolveHeaderValue(headers, 'x-supabase-authorization'),
  )

  let finalStatus = 500
  let resolvedUserId: string | null = null

  try {
    if (!bearerToken) {
      finalStatus = 401
      context.res = json(401, { message: 'missing bearer' })
      return
    }

    const { url, anonKey } = getControlSupabaseConfig()
    const { serviceRoleKey } = getControlSupabaseServiceRole()

    const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

    const { data: authResult, error: authError } = await authClient.auth.getUser(bearerToken)
    if (authError) {
      finalStatus = 401
      context.res = json(401, { message: 'invalid bearer' })
      return
    }

    const user = authResult?.user
    if (!user?.id) {
      finalStatus = 401
      context.res = json(401, { message: 'invalid bearer' })
      return
    }

    resolvedUserId = user.id

    const { data: adminResult, error: adminError } = await adminClient.auth.admin.getUserById(user.id)
    if (adminError) {
      finalStatus = 500
      context.res = json(500, { message: 'failed to load user' })
      return
    }

    const adminUser = adminResult?.user
    if (!adminUser) {
      finalStatus = 404
      context.res = json(404, { message: 'user not found' })
      return
    }

    finalStatus = 200
    context.res = json(200, {
      id: adminUser.id,
      email: typeof adminUser.email === 'string' ? adminUser.email : null,
      raw_user_meta_data: adminUser.raw_user_meta_data ?? null,
    })
  } catch (error) {
    finalStatus = 500
    context.res = json(500, { message: 'internal error' })
    logError(context, 'users/me handler failed', error)
  } finally {
    logInfo(context, 'users/me request', {
      hasBearer: Boolean(bearerToken),
      status: finalStatus,
      userId: resolvedUserId,
    })
  }
}
