/** User navigation stays in the current browser tab. Agent views belong to the MCP lifecycle. */
export function navigatePackage(
  location: Pick<Location, "href">,
  input: Readonly<{packageId: string; route: string}>,
): void {
  const route = input.route.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  location.href = new URL(`/packages/${encodeURIComponent(input.packageId)}/${route}`, location.href).href
}
