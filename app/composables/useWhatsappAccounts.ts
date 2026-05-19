import type { ApiItemResponse, ApiListResponse, WhatsAppAccount } from '~~/types/entities'
import { useWhatsappAccountsStore } from '~~/stores/whatsappAccounts'

export function useWhatsappAccounts() {
  const store = useWhatsappAccountsStore()
  const toast = useToast()

  async function fetchAccounts() {
    store.loading = true
    try {
      const response = await $fetch<ApiListResponse<WhatsAppAccount>>('/api/whatsapp/accounts')
      store.setAccounts(response.data)
      return response.data
    } finally {
      store.loading = false
    }
  }

  async function createInstance(displayName?: string) {
    const response = await $fetch<ApiItemResponse<WhatsAppAccount> & { mock?: boolean }>('/api/whatsapp/create-instance', {
      method: 'POST',
      body: {
        display_name: displayName
      }
    })

    store.upsertAccount(response.data)
    toast.add({
      title: response.mock ? 'Numero conectado no modo mock' : 'QR Code gerado',
      description: response.mock ? 'A Evolution API nao esta configurada, entao o status foi simulado.' : 'Escaneie o QR Code para finalizar a conexao.',
      color: 'success'
    })
    return response.data
  }

  async function reconnect(id: string) {
    const response = await $fetch<ApiItemResponse<WhatsAppAccount> & { mock?: boolean }>(`/api/whatsapp/connect/${id}`)
    store.upsertAccount(response.data)
    return response.data
  }

  async function disconnect(id: string) {
    const response = await $fetch<ApiItemResponse<WhatsAppAccount>>('/api/whatsapp/disconnect', {
      method: 'POST',
      body: { id }
    })
    store.upsertAccount(response.data)
    toast.add({
      title: 'Numero desconectado',
      color: 'success'
    })
    return response.data
  }

  async function simulateIncomingMessage(accountId: string) {
    const response = await $fetch('/api/dev/simulate-message', {
      method: 'POST',
      body: {
        whatsapp_account_id: accountId,
        phone: '5511999999999',
        name: 'Cliente Demo',
        body: 'Oi, gostaria de saber mais sobre o atendimento.'
      }
    })

    toast.add({
      title: 'Mensagem simulada recebida',
      color: 'success'
    })

    return response
  }

  return {
    store,
    accounts: computed(() => store.accounts),
    loading: computed(() => store.loading),
    connectedAccounts: computed(() => store.connectedAccounts),
    selectedAccount: computed(() => store.selectedAccount),
    fetchAccounts,
    createInstance,
    reconnect,
    disconnect,
    simulateIncomingMessage
  }
}
