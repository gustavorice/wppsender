import { getRouterParam } from 'h3'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { getClerkBackend } from '~~/server/utils/clerk'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'team:delete', 20, 60)

    const tenant = requireOrgAdmin(event)
    const userId = getRouterParam(event, 'id')

    if (!userId) {
      throw apiError(400, 'User ID nao informado.')
    }

    if (userId === tenant.userId) {
      throw apiError(400, 'Voce nao pode remover a si mesmo.')
    }

    const clerk = getClerkBackend(event)
    await clerk.organizations.deleteOrganizationMembership({
      organizationId: tenant.orgId,
      userId
    })

    return { data: { userId } }
  } catch (error) {
    throw normalizeError(error)
  }
})
