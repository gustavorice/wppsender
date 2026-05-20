import { z } from 'zod'
import { getRouterParam } from 'h3'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { getClerkBackend } from '~~/server/utils/clerk'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  role: z.enum(['org:owner', 'org:admin', 'org:agent', 'org:member'])
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'team:patch', 20, 60)

    const tenant = requireOrgAdmin(event)
    const userId = getRouterParam(event, 'id')

    if (!userId) {
      throw apiError(400, 'User ID nao informado.')
    }

    const body = schema.parse(await readBody(event))
    const clerk = getClerkBackend(event)

    const updated = await clerk.organizations.updateOrganizationMembership({
      organizationId: tenant.orgId,
      userId,
      role: body.role
    })

    return {
      data: {
        id: updated.id,
        userId,
        role: updated.role
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
