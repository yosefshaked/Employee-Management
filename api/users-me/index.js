/* eslint-env node */
import jwt from 'jsonwebtoken'

export default async function (context, req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization
  const value = typeof header === 'string' ? header : header?.toString()

  if (!value || !value.startsWith('Bearer ')) {
    return {
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Missing or invalid Authorization header' }
    }
  }

  const token = value.slice('Bearer '.length)

  try {
    const decoded = jwt.decode(token)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        sub: decoded?.sub,
        email: decoded?.email || decoded?.user_metadata?.email || decoded?.email,
        role: decoded?.role,
        aud: decoded?.aud,
        exp: decoded?.exp
      }
    }
  } catch (error) {
    context.log?.error?.('Failed to decode JWT', error)
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Invalid JWT' }
    }
  }
}
