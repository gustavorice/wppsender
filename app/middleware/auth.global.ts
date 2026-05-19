const protectedPrefixes = ['/dashboard', '/messages', '/contacts', '/settings']

export default defineNuxtRouteMiddleware((to) => {
  const { isLoaded, isSignedIn } = useAuth()

  if (!import.meta.client) {
    return
  }

  const isProtected = protectedPrefixes.some((prefix) => to.path === prefix || to.path.startsWith(`${prefix}/`))

  if (isProtected && isLoaded.value && !isSignedIn.value) {
    return navigateTo('/login')
  }

  if (to.path === '/login' && isLoaded.value && isSignedIn.value) {
    return navigateTo('/dashboard')
  }
})
