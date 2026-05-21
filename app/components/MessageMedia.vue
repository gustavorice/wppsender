<script setup lang="ts">
import type { Message } from '~~/types/entities'

const props = defineProps<{
  message: Message
}>()

const url = ref<string | null>(null)
const loading = ref(false)
const failed = ref(false)

// Resolves to a proxied URL hosted on Supabase Storage. The /api/messages/:id/media
// endpoint does the Evolution download + decrypt + upload on first hit; afterwards
// the bucket URL is returned straight away.
async function resolveMedia() {
  if (url.value || loading.value) return
  // If the DB already has a Storage URL (post-backfill), use it directly.
  const existing = props.message.media_url
  if (existing && existing.includes('/storage/v1/object/public/')) {
    url.value = existing
    return
  }
  loading.value = true
  failed.value = false
  try {
    const r = await $fetch<{ data: { url: string } }>(`/api/messages/${props.message.id}/media`)
    url.value = r.data.url
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(resolveMedia)

watch(() => props.message.id, () => {
  url.value = null
  failed.value = false
  resolveMedia()
})

const isOutbound = computed(() => props.message.direction === 'outbound')
</script>

<template>
  <div class="space-y-1.5">
    <!-- IMAGE -->
    <div v-if="message.type === 'image'" class="overflow-hidden rounded-md">
      <div
        v-if="loading || (!url && !failed)"
        class="flex aspect-video w-72 items-center justify-center bg-slate-200/40"
      >
        <UIcon name="i-lucide-loader-2" class="h-6 w-6 animate-spin text-slate-500" />
      </div>
      <div v-else-if="failed" class="flex aspect-video w-72 items-center justify-center bg-rose-50 text-xs text-rose-700">
        Não foi possível carregar a imagem
      </div>
      <a v-else :href="url ?? '#'" target="_blank" rel="noopener noreferrer" class="block">
        <img :src="url ?? undefined" alt="Imagem" class="max-h-80 w-72 max-w-full rounded-md object-cover" />
      </a>
    </div>

    <!-- AUDIO -->
    <div v-else-if="message.type === 'audio'" class="min-w-[18rem]">
      <div v-if="loading || (!url && !failed)" class="flex h-10 items-center gap-2 rounded-md bg-slate-100 px-3 text-xs text-slate-500">
        <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin" />
        Baixando áudio…
      </div>
      <div v-else-if="failed" class="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">Áudio indisponível</div>
      <audio v-else :src="url ?? undefined" controls preload="metadata" class="w-72 max-w-full" />
    </div>

    <!-- VIDEO -->
    <div v-else-if="message.type === 'video'" class="overflow-hidden rounded-md">
      <div v-if="loading || (!url && !failed)" class="flex aspect-video w-72 items-center justify-center bg-slate-200/40">
        <UIcon name="i-lucide-loader-2" class="h-6 w-6 animate-spin text-slate-500" />
      </div>
      <div v-else-if="failed" class="flex aspect-video w-72 items-center justify-center bg-rose-50 text-xs text-rose-700">
        Vídeo indisponível
      </div>
      <video v-else :src="url ?? undefined" controls preload="metadata" class="max-h-80 w-72 max-w-full rounded-md" />
    </div>

    <!-- DOCUMENT -->
    <div v-else-if="message.type === 'document'" class="min-w-[16rem]">
      <a
        v-if="url && !failed"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        :download="true"
        class="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
        :class="isOutbound ? 'text-emerald-900' : 'text-slate-800'"
      >
        <UIcon name="i-lucide-file-text" class="h-5 w-5 shrink-0 text-slate-500" />
        <span class="truncate">Abrir documento</span>
        <UIcon name="i-lucide-external-link" class="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
      </a>
      <div v-else-if="loading" class="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
        <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin" />
        Baixando documento…
      </div>
      <div v-else-if="failed" class="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">Documento indisponível</div>
    </div>

    <!-- Caption (e.g. image with text) -->
    <p v-if="message.body" class="whitespace-pre-wrap text-sm leading-6">{{ message.body }}</p>
  </div>
</template>
