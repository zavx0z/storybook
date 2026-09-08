import {storybookPackageUrlPath} from "@zavx0z/storybook-browser-lifecycle/contract"
/** User navigation stays in the current browser tab. Agent views belong to the MCP lifecycle. */
export function navigatePackage(
  location: Pick<Location, "href">,
  input: Readonly<{packageId: string; route: string}>,
): void {
  location.href = new URL(storybookPackageUrlPath(input.packageId, input.route), location.href).href
}
