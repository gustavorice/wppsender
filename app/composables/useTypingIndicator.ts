import type { RealtimeChannel } from '@supabase/supabase-js'

type PresenceState = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable' | string

interface TypingPayload {
  wa_id: string
  state: PresenceState
  at: number
}

/**
 * Listens for typing/recording presence broadcasts published by the server
 * webhook when Evolution emits PRESENCE_UPDATE. Returns a ref that holds
 * the active state ('composing' | 'recording' | null) for the currently
 * watched (accountId, waId) pair. Auto-clears after 8s of silence (Baileys
 * itself expires presence in ~10s).
 */
export function useTypingIndicator(
  accountIdRef: MaybeRefOrGetter<string | null | undefined>,
  waIdRef: MaybeRefOrGetter<string | null | undefined>
) {
  const nuxtApp = useNuxtApp()
  const state = ref<PresenceState | null>(null)
  let channel: RealtimeChannel | null = null
  let clearTimer: ReturnType<typeof setTimeout> | null = null

  function clearState() {
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
    state.value = null
  }

  function scheduleClear() {
    if (clearTimer) clearTimeout(clearTimer)
    clearTimer = setTimeout(() => {
      state.value = null
      clearTimer = null
    }, 8000)
  }

  async function unsubscribe() {
    if (channel) {
      try {
        await nuxtApp.$supabase.removeChannel(channel)
      } catch {
        /* ignore */
      }
      channel = null
    }
    clearState()
  }

  watch(
    () => [toValue(accountIdRef), toValue(waIdRef)] as const,
    async ([accId, waId]) => {
      await unsubscribe()
      if (!accId || !waId) return
      channel = nuxtApp.$supabase
        .channel(`presence:${accId}:${waId}`)
        .on('broadcast', { event: 'typing' }, (msg) => {
          const payload = msg.payload as TypingPayload
          if (!payload || payload.wa_id !== waId) return
          if (payload.state === 'composing' || payload.state === 'recording') {
            state.value = payload.state
            scheduleClear()
          } else {
            clearState()
          }
        })
        .subscribe()
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    void unsubscribe()
  })

  return {
    state: computed(() => state.value),
    isTyping: computed(() => state.value === 'composing'),
    isRecording: computed(() => state.value === 'recording')
  }
}
