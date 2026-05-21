<script setup lang="ts">
import type { WhatsAppAccount } from '~~/types/entities'

const props = defineProps<{
  account: WhatsAppAccount
  canManage?: boolean
  mock?: boolean
  enriching?: boolean
  reconciling?: boolean
}>()

const emit = defineEmits<{
  connect: [id: string]
  disconnect: [id: string]
  remove: [id: string]
  simulate: [id: string]
  enrich: [id: string]
  reconcile: [id: string]
}>()

function confirmRemove() {
  const ok = window.confirm(`Remover o numero "${props.account.display_name || props.account.instance_name}" definitivamente? A instancia Evolution sera deletada e as conversas vinculadas serao perdidas.`)
  if (ok) emit('remove', props.account.id)
}

const statusMap = computed(() => {
  const map = {
    connected: { label: 'connected', color: 'success', icon: 'i-lucide-check-circle-2' },
    pending: { label: 'pending', color: 'warning', icon: 'i-lucide-clock-3' },
    disconnected: { label: 'disconnected', color: 'neutral', icon: 'i-lucide-unplug' },
    error: { label: 'error', color: 'error', icon: 'i-lucide-circle-alert' }
  } as const

  return map[props.account.status]
})
</script>

<template>
  <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="truncate text-sm font-semibold text-slate-950">{{ account.display_name || 'WhatsApp' }}</h3>
          <UBadge :color="statusMap.color" variant="soft" size="sm">
            <UIcon :name="statusMap.icon" class="mr-1 h-3 w-3" />
            {{ statusMap.label }}
          </UBadge>
        </div>
        <p class="mt-1 truncate text-xs text-slate-500">{{ account.phone_number || account.instance_name }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UButton
          v-if="canManage && account.status !== 'connected'"
          icon="i-lucide-qr-code"
          size="sm"
          variant="outline"
          @click="emit('connect', account.id)"
        >
          QR
        </UButton>
        <UButton
          v-if="canManage && account.status === 'connected'"
          icon="i-lucide-unplug"
          size="sm"
          color="neutral"
          variant="outline"
          @click="emit('disconnect', account.id)"
        >
          Desconectar
        </UButton>
        <UButton
          v-if="canManage"
          icon="i-lucide-trash-2"
          size="sm"
          color="error"
          variant="ghost"
          aria-label="Remover"
          @click="confirmRemove"
        />
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600">
      <div class="rounded-md bg-slate-50 p-3">
        <p class="font-medium text-slate-500">Criado em</p>
        <p class="mt-1 text-slate-900">{{ new Date(account.created_at).toLocaleDateString('pt-BR') }}</p>
      </div>
      <div class="rounded-md bg-slate-50 p-3">
        <p class="font-medium text-slate-500">Ultima conexao</p>
        <p class="mt-1 text-slate-900">
          {{ account.last_connected_at ? new Date(account.last_connected_at).toLocaleDateString('pt-BR') : 'Nunca' }}
        </p>
      </div>
    </div>

    <div v-if="account.status === 'connected'" class="mt-4 flex flex-wrap gap-2">
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-image-down"
        :loading="enriching"
        @click="emit('enrich', account.id)"
      >
        Sincronizar fotos
      </UButton>
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-list-restart"
        :loading="reconciling"
        @click="emit('reconcile', account.id)"
      >
        Reorganizar inbox
      </UButton>
      <UButton
        v-if="mock"
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-message-square-plus"
        @click="emit('simulate', account.id)"
      >
        Simular mensagem
      </UButton>
    </div>
  </div>
</template>
