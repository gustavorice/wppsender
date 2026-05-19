<script setup lang="ts">
import type { WhatsAppAccount } from '~~/types/entities'

definePageMeta({ layout: 'private' })

const { canManageWhatsapp } = useCurrentOrganization()
const {
  fetchAccounts,
  createInstance,
  reconnect,
  disconnect,
  simulateIncomingMessage,
  syncContacts,
  accounts,
  loading
} = useWhatsappAccounts()

const syncedAccountIds = ref<Set<string>>(new Set())

watch(
  accounts,
  (next) => {
    for (const acc of next) {
      if (acc.status === 'connected' && !syncedAccountIds.value.has(acc.id)) {
        syncedAccountIds.value.add(acc.id)
        void syncContacts(acc.id)
      }
    }
  },
  { deep: true }
)

useRealtimeConversations()

const toast = useToast()
const creating = ref(false)
const connectingId = ref<string | null>(null)
const qrAccount = ref<WhatsAppAccount | null>(null)
const displayName = ref('')
const showDevTools = import.meta.dev

async function connectNewNumber() {
  creating.value = true
  try {
    const account = await createInstance(displayName.value || undefined)
    qrAccount.value = account
    displayName.value = ''
  } catch (error) {
    toast.add({
      title: 'Nao foi possivel criar a instancia',
      description: error instanceof Error ? error.message : 'Verifique as credenciais da Evolution API.',
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

async function retryConnect(id: string) {
  connectingId.value = id
  try {
    const account = await reconnect(id)
    qrAccount.value = account
  } finally {
    connectingId.value = null
  }
}

async function disconnectAccount(id: string) {
  await disconnect(id)
}

async function simulate(accountId: string) {
  await simulateIncomingMessage(accountId)
  await navigateTo('/messages')
}

onMounted(fetchAccounts)
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <h1 class="text-xl font-semibold text-slate-950">Numeros de WhatsApp</h1>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
          Conecte um ou mais numeros via Evolution API. A instancia usa nome seguro e nunca usa telefone como identificador.
        </p>
      </div>
      <form v-if="canManageWhatsapp" class="flex w-full flex-col gap-2 sm:flex-row xl:w-auto" @submit.prevent="connectNewNumber">
        <UInput v-model="displayName" placeholder="Nome do numero" icon="i-lucide-smartphone" class="w-full sm:w-64" />
        <UButton type="submit" icon="i-lucide-qr-code" :loading="creating">
          Conectar WhatsApp
        </UButton>
      </form>
    </div>

    <LoadingState v-if="loading" label="Carregando numeros" />
    <EmptyState
      v-else-if="accounts.length === 0"
      title="Nenhum numero conectado"
      description="Owners e admins podem conectar o primeiro numero e liberar o atendimento do time."
    />
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <WhatsAppAccountCard
        v-for="account in accounts"
        :key="account.id"
        :account="account"
        :can-manage="canManageWhatsapp"
        :mock="showDevTools"
        @connect="retryConnect"
        @disconnect="disconnectAccount"
        @simulate="simulate"
      />
    </div>

    <WhatsAppQrModal
      :open="Boolean(qrAccount)"
      :account="qrAccount"
      :loading="Boolean(connectingId)"
      @close="qrAccount = null"
      @retry="retryConnect"
    />
  </div>
</template>
