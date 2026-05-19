import { z } from 'zod'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { getClerkBackend } from '~~/server/utils/clerk'
import { normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  email: z.string().email(),
  role: z.enum(['org:owner', 'org:admin', 'org:agent', 'org:member']).default('org:agent')
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'team:invite', 20, 60)

    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event))
    const clerk = getClerkBackend(event)

    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: tenant.orgId,
      emailAddress: body.email,
      role: body.role,
      inviterUserId: tenant.userId
    })

    return {
      data: {
        id: invitation.id,
        emailAddress: invitation.emailAddress,
        role: invitation.role,
        status: invitation.status
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
