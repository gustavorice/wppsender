import type { H3Event } from 'h3'
import { apiError } from './errors'
import { requireTenantAuth, type TenantAuth } from './auth'

export function getTenant(event: H3Event): TenantAuth {
  return requireTenantAuth(event)
}

export function assertSameTenant(recordOrgId: string | null | undefined, tenantOrgId: string): void {
  if (!recordOrgId || recordOrgId !== tenantOrgId) {
    throw apiError(404, 'Registro nao encontrado neste time.')
  }
}

export function sanitizeOrgIdForInstanceName(orgId: string): string {
  return orgId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 48)
}

export function generateInstanceName(orgId: string): string {
  const randomId = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `org_${sanitizeOrgIdForInstanceName(orgId)}_wa_${randomId}`
}
