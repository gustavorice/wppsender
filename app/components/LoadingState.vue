<script setup lang="ts">
defineProps<{
  label?: string
}>()
</script>

<template>
  <div class="flex min-h-[240px] items-center justify-center p-6 text-slate-600">
    <div class="flex items-center gap-3">
      <UIcon name="i-lucide-loader-circle" class="h-5 w-5 animate-spin text-emerald-600" />
      <span class="text-sm font-medium">{{ label || 'Carregando' }}</span>
    </div>
  </div>
</template>
