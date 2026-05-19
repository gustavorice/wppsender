import { requireOrgAdmin } from '~~/server/utils/auth'
import { getClerkBackend } from '~~/server/utils/clerk'
import { normalizeError } from '~~/server/utils/errors'

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireOrgAdmin(event)
    const clerk = getClerkBackend(event)

    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: tenant.orgId,
      limit: 100
    })

    return {
      data: memberships.data.map((membership) => ({
        id: membership.id,
        role: membership.role,
        createdAt: membership.createdAt,
        publicUserData: membership.publicUserData
      }))
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
