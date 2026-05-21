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

  async function removeAccount(id: string) {
    try {
      await $fetch('/api/whatsapp/remove', {
        method: 'POST',
        body: { id }
      })
      store.accounts = store.accounts.filter((a) => a.id !== id)
      toast.add({ title: 'Numero removido', color: 'success' })
    } catch (error) {
      toast.add({
        title: 'Falha ao remover',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        color: 'error'
      })
      throw error
    }
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

  async function syncContacts(accountId: string) {
    try {
      const response = await $fetch<{ data: { synced: number; account_id: string } }>('/api/whatsapp/sync', {
        method: 'POST',
        body: { whatsapp_account_id: accountId }
      })
      if (response.data?.synced) {
        toast.add({
          title: `${response.data.synced} contatos sincronizados`,
          color: 'success'
        })
      }
      return response.data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar contatos.'
      toast.add({ title: 'Sync de contatos falhou', description: message, color: 'warning' })
      return null
    }
  }

  async function enrichAvatars(accountId: string) {
    try {
      const response = await $fetch<{ data: { scanned: number; attempted: number; updated: number } }>('/api/whatsapp/enrich-avatars', {
        method: 'POST',
        body: { whatsapp_account_id: accountId }
      })
      toast.add({
        title: `${response.data.updated} fotos atualizadas`,
        description: `${response.data.attempted} contatos consultados.`,
        color: response.data.updated > 0 ? 'success' : 'info'
      })
      return response.data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao buscar fotos.'
      toast.add({ title: 'Sync de fotos falhou', description: message, color: 'warning' })
      return null
    }
  }

  async function syncHistory(accountId: string) {
    try {
      const response = await $fetch<{ data: { synced: number; conversations: number; contacts: number } }>('/api/whatsapp/sync-history', {
        method: 'POST',
        body: { whatsapp_account_id: accountId }
      })
      if (response.data?.synced) {
        toast.add({
          title: `${response.data.synced} mensagens importadas em ${response.data.conversations} conversas`,
          color: 'success'
        })
      }
      return response.data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar historico.'
      toast.add({ title: 'Sync de historico falhou', description: message, color: 'warning' })
      return null
    }
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
    removeAccount,
    simulateIncomingMessage,
    syncContacts,
    syncHistory,
    enrichAvatars
  }
}
