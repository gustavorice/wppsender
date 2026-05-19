<script setup lang="ts">
import type { Conversation } from '~~/types/entities'

const props = defineProps<{
  conversation: Conversation
}>()

const { sendMessage, sending } = useMessages()
const text = ref('')

async function submit() {
  const value = text.value.trim()
  if (!value) {
    return
  }

  await sendMessage({
    whatsapp_account_id: props.conversation.whatsapp_account_id,
    conversation_id: props.conversation.id,
    text: value
  })

  text.value = ''
}
</script>

<template>
  <form class="border-t border-slate-200 bg-white p-3" @submit.prevent="submit">
    <div class="flex items-end gap-2">
      <UTextarea
        v-model="text"
        class="min-w-0 flex-1"
        autoresize
        :rows="1"
        placeholder="Responder mensagem"
        @keydown.enter.exact.prevent="submit"
      />
      <UButton type="submit" icon="i-lucide-send" :loading="sending" :disabled="!text.trim()">
        Enviar
      </UButton>
    </div>
  </form>
</template>
