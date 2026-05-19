import { createError, type H3Error } from 'h3'

export function apiError(statusCode: number, statusMessage: string, data?: unknown): H3Error {
  return createError({
    statusCode,
    statusMessage,
    data
  })
}

export function normalizeError(error: unknown): H3Error {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    return error as H3Error
  }

  const message = error instanceof Error ? error.message : 'Erro inesperado'
  return apiError(500, message)
}

export function assertSupabaseResult<T>(data: T | null, error: { message: string } | null, fallback = 'Erro no banco de dados'): T {
  if (error) {
    throw apiError(500, error.message || fallback)
  }

  if (data === null) {
    throw apiError(404, 'Registro não encontrado')
  }

  return data
}
