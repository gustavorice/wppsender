import type { H3Event } from 'h3'
import { clerkClient } from '@clerk/nuxt/server'

export function getClerkBackend(event: H3Event) {
  return clerkClient(event)
}
