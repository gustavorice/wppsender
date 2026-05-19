<script setup lang="ts">
import QRCode from 'qrcode'
import type { WhatsAppAccount } from '~~/types/entities'

const props = defineProps<{
  account: WhatsAppAccount | null
  open: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
  retry: [id: string]
}>()

const qrImage = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

function formatQrCode(value: string) {
  if (value.startsWith('data:image')) {
    return value
  }

  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 80) {
    return `data:image/png;base64,${value}`
  }

  return null
}

async function renderQr() {
  const raw = props.account?.qr_code
  qrImage.value = ''

  if (!raw) {
    return
  }

  const image = formatQrCode(raw)
  qrImage.value = image || (await QRCode.toDataURL(raw, { width: 280, margin: 2 }))
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (!props.account?.id) return
    if (props.account.status === 'connected') {
      stopPolling()
      return
    }
    if (!props.account.qr_code) {
      emit('retry', props.account.id)
    }
  }, 4000)
}

watch(() => props.account?.qr_code, renderQr, { immediate: true })

watch(
  () => [props.open, props.account?.status, props.account?.qr_code] as const,
  ([isOpen, status, qr]) => {
    if (!isOpen) {
      stopPolling()
      return
    }
    if (status === 'connected') {
      stopPolling()
      return
    }
    if (!qr) {
      startPolling()
    } else {
      stopPolling()
    }
  },
  { immediate: true }
)

onScopeDispose(() => {
  stopPolling()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open && account" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div class="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-950">Conectar WhatsApp</h2>
            <p class="mt-1 text-sm text-slate-600">{{ account.display_name || 'Numero WhatsApp' }}</p>
          </div>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Fechar" @click="emit('close')" />
        </div>

        <div class="flex min-h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-5">
          <img v-if="qrImage" :src="qrImage" alt="QR Code do WhatsApp" class="h-[280px] w-[280px] rounded-md bg-white p-3" />
          <div v-else-if="account.status === 'connected'" class="text-center">
            <UIcon name="i-lucide-check-circle-2" class="mx-auto h-10 w-10 text-emerald-600" />
            <p class="mt-3 text-sm font-medium text-slate-900">Numero conectado</p>
          </div>
          <div v-else class="text-center">
            <LoadingState label="Gerando QR Code" />
            <p class="mt-3 text-xs text-slate-500">A Evolution API leva alguns segundos para responder.</p>
          </div>
        </div>

        <div class="mt-5 flex items-center justify-between gap-3">
          <p class="text-xs leading-5 text-slate-500">Abra o WhatsApp, acesse aparelhos conectados e escaneie o codigo.</p>
          <UButton
            :loading="loading"
            icon="i-lucide-refresh-cw"
            variant="outline"
            @click="emit('retry', account.id)"
          >
            Retry
          </UButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
