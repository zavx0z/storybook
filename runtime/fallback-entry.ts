import {storybookPackageRouteFromPathname} from "@zavx0z/storybook-browser-lifecycle/contract"
import {startExternalStorybookPackage} from "./package-entry.ts"

function packageIdFromPathname(pathname: string): string {
  const packageId = document.querySelector<HTMLMetaElement>('meta[name="external-storybook-package-id"]')?.content
  if (!packageId) throw new Error("Storybook fallback has no exact package identity")
  if (storybookPackageRouteFromPathname(pathname, packageId) === null) {
    throw new Error(`External Storybook fallback pathname is malformed: ${pathname}`)
  }
  return packageId
}

if (typeof document !== "undefined") {
  const packageId = packageIdFromPathname(location.pathname)
  void startExternalStorybookPackage({
    packageId,
    candidateRevision: null,
    revisionUrl: null,
    loadRuntime: null,
    storyLoaders: new Map(),
  }).catch((error) => {
    document.documentElement.dataset.externalStorybook = "error"
    document.documentElement.dataset.externalStorybookPackage = "error"
    document.documentElement.dataset.externalStorybookError = error instanceof Error
      ? error.message
      : String(error)
    console.error(error)
  })
}
