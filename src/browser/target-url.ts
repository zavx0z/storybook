export function storybookTargetUrl(
  origin: string,
  route: string,
): string {
  const root = new URL("/", origin).href
  if (route === "/") return root
  if (!route.startsWith("/")) throw new Error(`storybook route must be an absolute pathname: ${route}`)
  const routeId = route.slice(1)
  if (routeId.length === 0 || routeId.includes("//") || /[?#]/.test(routeId)) {
    throw new Error(`storybook route must be a normalized pathname: ${route}`)
  }
  return new URL(`/${routeId}`, root).href
}
