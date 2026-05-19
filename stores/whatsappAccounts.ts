import { defineStore } from 'pinia'
import type { WhatsAppAccount } from '~~/types/entities'

export const useWhatsappAccountsStore = defineStore('whatsappAccounts', {
  state: () => ({
    accounts: [] as WhatsAppAccount[],
    loading: false,
    selectedAccountId: null as string | null
  }),
  getters: {
    connectedAccounts: (state) => state.accounts.filter((account) => account.status === 'connected'),
    selectedAccount: (state) => state.accounts.find((account) => account.id === state.selectedAccountId) || null
  },
  actions: {
    setAccounts(accounts: WhatsAppAccount[]) {
      this.accounts = accounts
      const firstAccount = accounts[0]
      if (!this.selectedAccountId && firstAccount) {
        this.selectedAccountId = firstAccount.id
      }
    },
    upsertAccount(account: WhatsAppAccount) {
      const index = this.accounts.findIndex((item) => item.id === account.id)

      if (index >= 0) {
        this.accounts.splice(index, 1, account)
      } else {
        this.accounts.unshift(account)
      }
    },
    setSelectedAccount(id: string | null) {
      this.selectedAccountId = id
    }
  }
})
