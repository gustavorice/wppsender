<script setup lang="ts">
interface Member {
  id: string
  role: string
  publicUserData?: {
    identifier?: string | null
    firstName?: string | null
    lastName?: string | null
    imageUrl?: string | null
  } | null
}

const toast = useToast()
const loading = ref(false)
const members = ref<Member[]>([])
const email = ref('')
const role = ref<'org:admin' | 'org:agent' | 'org:member'>('org:agent')

const roleOptions = [
  { label: 'Admin', value: 'org:admin' },
  { label: 'Agent', value: 'org:agent' },
  { label: 'Member', value: 'org:member' }
]

async function fetchMembers() {
  const response = await $fetch<{ data: Member[] }>('/api/team/members')
  members.value = response.data
}

async function invite() {
  loading.value = true
  try {
    await $fetch('/api/team/invite', {
      method: 'POST',
      body: {
        email: email.value,
        role: role.value
      }
    })
    toast.add({ title: 'Convite enviado', color: 'success' })
    email.value = ''
    await fetchMembers()
  } catch (error) {
    toast.add({
      title: 'Nao foi possivel convidar',
      description: error instanceof Error ? error.message : 'Verifique o e-mail e as roles configuradas no Clerk.',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

onMounted(fetchMembers)
</script>

<template>
  <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
    <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h2 class="text-sm font-semibold text-slate-950">Membros</h2>
      </div>
      <div class="divide-y divide-slate-100">
        <div v-for="member in members" :key="member.id" class="flex items-center justify-between gap-4 p-4">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-slate-950">
              {{ member.publicUserData?.identifier || `${member.publicUserData?.firstName || ''} ${member.publicUserData?.lastName || ''}`.trim() || 'Membro' }}
            </p>
            <p class="text-xs text-slate-500">{{ member.id }}</p>
          </div>
          <UBadge color="neutral" variant="soft">{{ member.role }}</UBadge>
        </div>
      </div>
    </div>

    <form class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" @submit.prevent="invite">
      <h2 class="text-sm font-semibold text-slate-950">Convidar por e-mail</h2>
      <div class="mt-4 space-y-3">
        <UInput v-model="email" type="email" icon="i-lucide-mail" placeholder="pessoa@empresa.com" required />
        <select
          v-model="role"
          class="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        >
          <option v-for="option in roleOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <UButton type="submit" block icon="i-lucide-send" :loading="loading" :disabled="!email">
          Enviar convite
        </UButton>
      </div>
    </form>
  </div>
</template>
