import type { H3Event } from 'h3'
import { apiError } from './errors'

export interface TenantAuth {
  userId: string
  orgId: string
  orgRole: string | null
  hasRole: (role: string) => boolean
}

export function requireTenantAuth(event: H3Event): TenantAuth {
  const authFactory = event.context.auth

  if (typeof authFactory !== 'function') {
    throw apiError(401, 'Clerk auth nao esta disponivel neste request.')
  }

  const auth = authFactory()

  if (!auth.isAuthenticated || !auth.userId) {
    throw apiError(401, 'Usuario nao autenticado.')
  }

  if (!auth.orgId) {
    throw apiError(403, 'Selecione uma organizacao ativa no Clerk.')
  }

  return {
    userId: auth.userId,
    orgId: auth.orgId,
    orgRole: auth.orgRole ?? null,
    hasRole: (role: string) => {
      if (auth.orgRole === role) {
        return true
      }

      return Boolean(auth.has?.({ role }))
    }
  }
}

export function requireOrgRole(event: H3Event, roles: string[]): TenantAuth {
  const tenant = requireTenantAuth(event)
  const allowed = roles.some((role) => tenant.hasRole(role))

  if (!allowed) {
    throw apiError(403, 'Voce nao tem permissao para executar esta acao.')
  }

  return tenant
}

export function requireOrgAdmin(event: H3Event): TenantAuth {
  return requireOrgRole(event, ['org:owner', 'org:admin'])
}
