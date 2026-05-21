import { waitUntil } from '@vercel/functions'
import { processEvolutionWebhook } from '~~/server/utils/evolutionWebhook'

// CRITICAL: Evolution's outbound webhook retries up to 10x with a 60s timeout
// per attempt. If we await `processEvolutionWebhook` inline the response is
// blocked until every DB write + Evolution enrichment call resolves, and a
// single MESSAGES_SET batch (100+ rows × ~3s each) will trigger the timeout
// for every retry — Evolution then drops the event entirely.
//
// Strategy: read the body, schedule processing with `waitUntil` so Vercel
// keeps the function alive for the background work, and respond 200 right
// away. Errors are logged but never thrown back to Evolution.
export default defineEventHandler(async (event) => {
  let payload: unknown
  try {
    payload = await readBody(event)
  } catch (err) {
    console.error('[webhook] failed to read body', err)
    return { ok: false, error: 'invalid_body' }
  }

  const job = processEvolutionWebhook(payload as any).catch((err) => {
    console.error('[webhook] background processing failed', err)
  })

  // `waitUntil` is a no-op outside Vercel (e.g. local dev); fall back to a
  // detached promise so the event loop drains naturally in long-running
  // Node environments.
  try {
    waitUntil(job)
  } catch {
    void job
  }

  return { ok: true, queued: true }
})
