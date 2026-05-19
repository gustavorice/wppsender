<script setup lang="ts">
import { OrganizationSwitcher as ClerkOrganizationSwitcher } from '@clerk/vue'
</script>

<template>
  <ClientOnly>
    <div class="max-w-[240px]">
      <ClerkOrganizationSwitcher
        after-create-organization-url="/dashboard"
        after-select-organization-url="/dashboard"
        create-organization-url="/dashboard"
        organization-profile-url="/settings/team"
        hide-personal
      />
    </div>
  </ClientOnly>
</template>
