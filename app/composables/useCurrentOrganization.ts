export function useCurrentOrganization() {
  const auth = useAuth()
  const organizationState = useOrganization()

  const organizationId = computed(() => auth.orgId.value || organizationState.organization.value?.id || null)
  const role = computed(() => auth.orgRole.value || null)
  const canManageTeam = computed(() => ['org:owner', 'org:admin'].includes(role.value || ''))
  const canManageWhatsapp = computed(() => canManageTeam.value)
  const canReply = computed(() => Boolean(auth.isSignedIn.value && organizationId.value))

  return {
    ...auth,
    organization: organizationState.organization,
    organizationId,
    role,
    canManageTeam,
    canManageWhatsapp,
    canReply
  }
}
