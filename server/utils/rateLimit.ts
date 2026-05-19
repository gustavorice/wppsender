import type { H3Event } from 'h3'
import { getRequestIP } from 'h3'
import { apiError } from './errors'

export async function rateLimit(event: H3Event, key: string, limit = 30, windowSeconds = 60): Promise<void> {
  const config = useRuntimeConfig()

  if (!config.upstashRedisRestUrl || !config.upstashRedisRestToken) {
    return
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const redisKey = `ratelimit:${key}:${ip}`

  const response = await $fetch<Array<{ result?: number }>>(new URL('/pipeline', config.upstashRedisRestUrl).toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.upstashRedisRestToken}`,
      'Content-Type': 'application/json'
    },
    body: [
      ['INCR', redisKey],
      ['EXPIRE', redisKey, windowSeconds]
    ]
  }).catch(() => null)

  const count = Number(response?.[0]?.result || 0)

  if (count > limit) {
    throw apiError(429, 'Muitas tentativas. Tente novamente em instantes.')
  }
}
