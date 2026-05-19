import { processEvolutionWebhook } from '~~/server/utils/evolutionWebhook'
import { normalizeError } from '~~/server/utils/errors'

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody(event)
    return processEvolutionWebhook(payload)
  } catch (error) {
    throw normalizeError(error)
  }
})
