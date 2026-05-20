<script setup lang="ts">
import type { Contact, WhatsAppAccount } from '~~/types/entities'
import { formatPhone, isLidWaId } from '~/utils/phone'

const props = defineProps<{
  contacts: Contact[]
  accounts: WhatsAppAccount[]
  loading?: boolean
  openingId?: string | null
}>()

const emit = defineEmits<{
  filter: [payload: { search: string; whatsappAccountId: string | null }]
  openContact: [contactId: string]
}>()

const search = ref('')
const whatsappAccountId = ref<string | null>(null)

const accountName = (id: string) => {
  const account = props.accounts.find((item) => item.id === id)
  return account?.display_name || account?.phone_number || 'WhatsApp'
}

watch([search, whatsappAccountId], () => {
  emit('filter', { search: search.value, whatsappAccountId: whatsappAccountId.value })
})
</script>

<template>
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Buscar por nome ou telefone" class="w-full" />
      <select
        v-model="whatsappAccountId"
        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:w-64"
      >
        <option :value="null">Todos os numeros</option>
        <option v-for="account in accounts" :key="account.id" :value="account.id">
          {{ account.display_name || account.phone_number || 'WhatsApp' }}
        </option>
      </select>
    </div>

    <LoadingState v-if="loading" label="Carregando contatos" />
    <EmptyState
      v-else-if="contacts.length === 0"
      class="m-4"
      icon="i-lucide-users"
      title="Sem contatos"
      description="Contatos sao criados automaticamente quando novas mensagens chegam."
    />

    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th class="px-4 py-3">Contato</th>
            <th class="px-4 py-3">Telefone</th>
            <th class="px-4 py-3">Numero</th>
            <th class="px-4 py-3">Tags</th>
            <th class="px-4 py-3">Criado</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white">
          <tr
            v-for="contact in contacts"
            :key="contact.id"
            class="cursor-pointer transition hover:bg-emerald-50"
            :class="openingId === contact.id ? 'opacity-50' : ''"
            @click="emit('openContact', contact.id)"
          >
            <td class="px-4 py-3 font-medium text-slate-950">
              <div class="flex items-center gap-3">
                <div class="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-slate-100">
                  <img
                    v-if="contact.avatar_url"
                    :src="contact.avatar_url"
                    :alt="contact.name || ''"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
                  />
                  <div v-else class="flex h-full w-full items-center justify-center text-[10px] font-semibold text-slate-600">
                    {{ (contact.name || '?').slice(0, 1).toUpperCase() }}
                  </div>
                </div>
                <span>{{ contact.name || formatPhone(contact.phone || contact.wa_id) || 'Sem cadastro' }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-slate-600">
              <template v-if="formatPhone(contact.phone || contact.wa_id)">
                {{ formatPhone(contact.phone || contact.wa_id) }}
              </template>
              <span v-else class="text-xs italic text-slate-400">Sem nº cadastrado</span>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ accountName(contact.whatsapp_account_id) }}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-1">
                <UBadge v-for="tag in contact.tags || []" :key="tag" size="sm" variant="soft" color="neutral">{{ tag }}</UBadge>
                <span v-if="!contact.tags?.length" class="text-slate-400">-</span>
              </div>
            </td>
            <td class="px-4 py-3 text-slate-500">{{ new Date(contact.created_at).toLocaleDateString('pt-BR') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
