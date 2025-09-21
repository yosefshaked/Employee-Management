/* eslint-env node */
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const { CONTROL_SUPABASE_URL, CONTROL_SUPABASE_SERVICE_ROLE } = process.env

function ensure(value, name) {
  if (!value) {
    throw new Error(`Missing environment variable ${name}`)
  }
  return value
}

export default async function (context, req) {
  try {
    const orgId = context?.bindingData?.orgId
    if (!orgId) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: { error: 'Missing orgId in route' }
      }
    }

    const header = req?.headers?.authorization ?? req?.headers?.Authorization
    const value = typeof header === 'string' ? header : header?.toString()

    if (!value || !value.startsWith('Bearer ')) {
      return {
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: { error: 'Missing or invalid Authorization header' }
      }
    }

    const url = ensure(CONTROL_SUPABASE_URL, 'CONTROL_SUPABASE_URL')
    const key = ensure(CONTROL_SUPABASE_SERVICE_ROLE, 'CONTROL_SUPABASE_SERVICE_ROLE')

    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await supabase.rpc('get_org_public_keys', { p_org_id: orgId })

    if (error) {
      context.log?.error?.('get_org_public_keys error', error)
      const status = error.code === 'P0002' ? 404 : 500
      return {
        status,
        headers: { 'content-type': 'application/json' },
        body: { error: error.message }
      }
    }

    if (!data?.supabase_url || !data?.anon_key) {
      return {
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: { error: 'org not found or no access' }
      }
    }

    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: data
    }
  } catch (error) {
    context.log?.error?.('org-keys handler failure', error)
    return {
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Internal error' }
    }
  }
}
