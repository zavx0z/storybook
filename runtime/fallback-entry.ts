import {decodeExternalStorybookPackagePath} from "./client-protocol.ts"
import {startExternalStorybookPackage} from "./package-entry.ts"

function packageIdFromPathname(pathname: string): string {
  const segments = pathname.split("/")
  if (segments[0] !== "" || segments[1] !== "packages" || segments[2] === undefined) {
    throw new Error(`External Storybook fallback pathname is malformed: ${pathname}`)
  }
  return decodeExternalStorybookPackagePath(segments[2])
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
