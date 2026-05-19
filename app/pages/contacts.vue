<script setup lang="ts">
definePageMeta({ layout: 'private' })

const { fetchAccounts, accounts } = useWhatsappAccounts()
const { fetchContacts, contacts, loading } = useContacts()

async function filterContacts(payload: { search: string; whatsappAccountId: string | null }) {
  await fetchContacts(payload)
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
        <p class="mt-1 text-sm text-slate-600">Contatos criados pelo webhook e separados por time.</p>
      </div>
      <UButton to="/messages" icon="i-lucide-message-circle" variant="outline">Abrir conversas</UButton>
    </div>

    <ContactList :contacts="contacts" :accounts="accounts" :loading="loading" @filter="filterContacts" />
  </div>
</template>
