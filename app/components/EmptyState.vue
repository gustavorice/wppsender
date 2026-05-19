<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
}>()
</script>

<template>
  <div class="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
    <div class="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-600">
      <UIcon :name="icon || 'i-lucide-inbox'" class="h-5 w-5" />
    </div>
    <h2 class="text-base font-semibold text-slate-950">{{ title }}</h2>
    <p v-if="description" class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{{ description }}</p>
    <UButton v-if="actionLabel && actionTo" :to="actionTo" class="mt-5" icon="i-lucide-arrow-right">
      {{ actionLabel }}
    </UButton>
  </div>
</template>
