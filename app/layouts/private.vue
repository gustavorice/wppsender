<script setup lang="ts">
const { isLoaded, isSignedIn } = useAuth()
const { organization } = useOrganization()
</script>

<template>
  <div class="min-h-screen bg-[#f6f3ef] text-[#111111]">
    <LoadingState v-if="!isLoaded" label="Carregando sessão" />

    <div v-else-if="!isSignedIn" class="flex min-h-screen items-center justify-center px-6">
      <EmptyState
        icon="i-lucide-lock"
        title="Acesso restrito"
        description="Entre com sua conta para acessar o painel."
        action-label="Ir para login"
        action-to="/login"
      />
    </div>

    <div v-else-if="!organization" class="flex min-h-screen items-center justify-center px-6">
      <div class="hairline-panel w-full max-w-lg rounded-lg bg-[#fbfaf7] p-8">
        <div class="mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-[#111111] text-[#fbfaf7]">
          <UIcon name="i-lucide-building-2" class="h-5 w-5" />
        </div>
        <h1 class="text-xl font-semibold text-[#111111]">Selecione ou crie um time</h1>
        <p class="mt-2 text-sm leading-6 text-[#6b6258]">
          O painel usa Clerk Organizations para isolar números, contatos, conversas e mensagens por empresa.
        </p>
        <div class="mt-6">
          <OrganizationSwitcher />
        </div>
      </div>
    </div>

    <div v-else class="flex min-h-screen">
      <AppSidebar />
      <div class="min-w-0 flex-1">
        <Topbar />
        <main class="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          <slot />
        </main>
      </div>
    </div>
  </div>
</template>
