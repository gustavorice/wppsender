<script setup lang="ts">
import type { Conversation } from '~~/types/entities'

defineProps<{
  conversation: Conversation | null
}>()
</script>

<template>
  <aside class="hidden min-h-[calc(100vh-120px)] border-l border-slate-200 bg-white xl:block">
    <div v-if="conversation" class="p-4">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-md bg-emerald-50 text-base font-semibold text-emerald-800">
          {{ (conversation.contact?.name || conversation.contact?.phone || '?').slice(0, 1).toUpperCase() }}
        </div>
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-slate-950">{{ conversation.contact?.name || 'Contato' }}</h3>
          <p class="truncate text-xs text-slate-500">{{ conversation.contact?.phone || conversation.contact?.wa_id }}</p>
        </div>
      </div>

      <div class="mt-5 space-y-4">
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Tags</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UBadge v-for="tag in conversation.contact?.tags || []" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge>
            <span v-if="!conversation.contact?.tags?.length" class="text-sm text-slate-500">Sem tags</span>
          </div>
        </div>

        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Status</p>
          <p class="mt-1 text-sm text-slate-900">{{ conversation.status }}</p>
        </div>

        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Responsavel</p>
          <p class="mt-1 text-sm text-slate-900">{{ conversation.assigned_to_user_id || 'Nao atribuido' }}</p>
        </div>

        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Observacoes</p>
          <textarea
            class="mt-2 min-h-28 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            placeholder="Notas simples do atendimento"
          />
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      class="m-4"
      icon="i-lucide-user-round"
      title="Contato"
      description="Os dados do contato aparecem quando uma conversa estiver ativa."
    />
  </aside>
</template>
