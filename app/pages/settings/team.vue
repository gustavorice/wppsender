<script setup lang="ts">
definePageMeta({ layout: 'private' })

const { canManageTeam, role } = useCurrentOrganization()
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-semibold text-slate-950">Time e convites</h1>
      <p class="mt-1 text-sm text-slate-600">Membros, roles e convites sao gerenciados pelo Clerk Organizations.</p>
    </div>

    <InviteMemberForm v-if="canManageTeam" />
    <EmptyState
      v-else
      icon="i-lucide-lock"
      title="Sem permissao para convidar"
      :description="`Sua role atual e ${role || 'desconhecida'}. Agents podem visualizar e responder mensagens, mas nao convidam membros.`"
    />
  </div>
</template>
