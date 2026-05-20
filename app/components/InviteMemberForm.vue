<script setup lang="ts">
interface Member {
  id: string
  role: string
  publicUserData?: {
    identifier?: string | null
    firstName?: string | null
    lastName?: string | null
    imageUrl?: string | null
    user_id?: string | null
    userId?: string | null
  } | null
}

const { userId: currentUserId } = useCurrentOrganization()

const toast = useToast()
const loading = ref(false)
const members = ref<Member[]>([])
const email = ref('')
const role = ref<'org:admin' | 'org:agent' | 'org:member'>('org:agent')
const updatingMemberId = ref<string | null>(null)

const roleOptions = [
  { label: 'Admin', value: 'org:admin' },
  { label: 'Agent', value: 'org:agent' },
  { label: 'Member', value: 'org:member' }
]

const membersError = ref<string | null>(null)
const membersLoading = ref(false)

function memberUserId(m: Member): string | null {
  return (m.publicUserData?.user_id || m.publicUserData?.userId) ?? null
}

function memberLabel(m: Member): string {
  return (
    m.publicUserData?.identifier ||
    `${m.publicUserData?.firstName || ''} ${m.publicUserData?.lastName || ''}`.trim() ||
    'Membro'
  )
}

async function fetchMembers() {
  membersLoading.value = true
  membersError.value = null
  try {
    const response = await $fetch<{ data: Member[] }>('/api/team/members')
    members.value = response.data
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao carregar membros.'
    membersError.value = message
    toast.add({
      title: 'Nao foi possivel carregar membros',
      description: message,
      color: 'error'
    })
  } finally {
    membersLoading.value = false
  }
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

async function changeRole(member: Member, newRole: string) {
  const uid = memberUserId(member)
  if (!uid || member.role === newRole) return
  updatingMemberId.value = member.id
  try {
    await ($fetch as any)(`/api/team/members/${uid}`, {
      method: 'PATCH',
      body: { role: newRole }
    })
    toast.add({ title: `Role atualizada para ${newRole}`, color: 'success' })
    await fetchMembers()
  } catch (error) {
    toast.add({
      title: 'Falha ao atualizar role',
      description: error instanceof Error ? error.message : 'Tente novamente.',
      color: 'error'
    })
  } finally {
    updatingMemberId.value = null
  }
}

async function removeMember(member: Member) {
  const uid = memberUserId(member)
  if (!uid) return
  if (!window.confirm(`Remover ${memberLabel(member)} desta organizacao?`)) return
  updatingMemberId.value = member.id
  try {
    await ($fetch as any)(`/api/team/members/${uid}`, { method: 'DELETE' })
    toast.add({ title: 'Membro removido', color: 'success' })
    await fetchMembers()
  } catch (error) {
    toast.add({
      title: 'Falha ao remover',
      description: error instanceof Error ? error.message : 'Tente novamente.',
      color: 'error'
    })
  } finally {
    updatingMemberId.value = null
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
      <div v-if="membersError" class="m-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        {{ membersError }}
      </div>
      <div v-else-if="membersLoading" class="p-4 text-sm text-slate-500">Carregando membros...</div>
      <div v-else-if="members.length === 0" class="p-4 text-sm text-slate-500">Nenhum membro encontrado nesta organizacao ainda.</div>
      <div class="divide-y divide-slate-100">
        <div v-for="member in members" :key="member.id" class="flex items-center justify-between gap-3 p-4">
          <div class="flex min-w-0 items-center gap-3">
            <div class="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-200">
              <img
                v-if="member.publicUserData?.imageUrl"
                :src="member.publicUserData.imageUrl"
                :alt="memberLabel(member)"
                class="h-full w-full object-cover"
                loading="lazy"
                @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
              />
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-slate-950">
                {{ memberLabel(member) }}
                <span v-if="memberUserId(member) === currentUserId" class="ml-1 text-xs font-normal text-slate-500">(você)</span>
              </p>
              <p class="truncate text-xs text-slate-500">{{ memberUserId(member) || member.id }}</p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <select
              :value="member.role"
              :disabled="updatingMemberId === member.id || memberUserId(member) === currentUserId"
              class="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50"
              @change="(e: Event) => changeRole(member, (e.target as HTMLSelectElement).value)"
            >
              <option v-for="option in roleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              <option v-if="member.role === 'org:owner'" value="org:owner">Owner</option>
            </select>
            <UButton
              v-if="memberUserId(member) !== currentUserId"
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="ghost"
              :loading="updatingMemberId === member.id"
              aria-label="Remover membro"
              @click="removeMember(member)"
            />
          </div>
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
