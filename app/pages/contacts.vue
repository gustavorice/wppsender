<script setup lang="ts">
definePageMeta({ layout: 'private' })

const { fetchAccounts, accounts } = useWhatsappAccounts()
const { fetchContacts, contacts, loading } = useContacts()
const { openConversationForContact } = useConversations()
const toast = useToast()
const opening = ref<string | null>(null)

async function filterContacts(payload: { search: string; whatsappAccountId: string | null }) {
  await fetchContacts(payload)
}

async function openContact(contactId: string) {
  opening.value = contactId
  try {
    await openConversationForContact(contactId)
    await navigateTo('/messages')
  } catch (err) {
    toast.add({
      title: 'Nao foi possivel abrir conversa',
      description: err instanceof Error ? err.message : 'Tente novamente.',
      color: 'error'
    })
  } finally {
    opening.value = null
  }
}

onMounted(async () => {
  await Promise.all([fetchAccounts(), fetchContacts()])
})
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <h1 class="text-xl font-semibold text-slate-950">CRM de contatos</h1>
        <p class="mt-1 text-sm text-slate-600">Clique em um contato para abrir a conversa em Mensagens.</p>
      </div>
      <UButton to="/messages" icon="i-lucide-message-circle" variant="outline">Abrir conversas</UButton>
    </div>

    <ContactList
      :contacts="contacts"
      :accounts="accounts"
      :loading="loading"
      :opening-id="opening"
      @filter="filterContacts"
      @open-contact="openContact"
    />
  </div>
</template>
