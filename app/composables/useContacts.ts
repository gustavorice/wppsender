import type { ApiListResponse, Contact } from '~~/types/entities'

interface FetchContactsOptions {
  search?: string
  whatsappAccountId?: string | null
}

export function useContacts() {
  const contacts = ref<Contact[]>([])
  const loading = ref(false)

  async function fetchContacts(options: FetchContactsOptions = {}) {
    loading.value = true
    try {
      const response = await $fetch<ApiListResponse<Contact>>('/api/contacts', {
        query: {
          search: options.search || undefined,
          whatsapp_account_id: options.whatsappAccountId || undefined
        }
      })

      contacts.value = response.data
      return response.data
    } finally {
      loading.value = false
    }
  }

  return {
    contacts,
    loading,
    fetchContacts
  }
}
