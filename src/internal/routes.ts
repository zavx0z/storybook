import {
  storybookPageRoutes,
  type StorybookAppManifest,
  type StorybookPageManifest,
} from "../app.ts"

export type StorybookRecoveryTarget = Readonly<{
  canonicalPath: string
  shellPath: string
  pageId: string
}>

export function storybookPageRecoveryIndex(
  app: StorybookAppManifest,
  page: StorybookPageManifest,
): ReadonlyMap<string, StorybookRecoveryTarget> {
  const routes = storybookPageRoutes(app, page)
  const shellPath = routes[0]
  if (shellPath === undefined) throw new Error(`Storybook page has no root route: ${page.id}`)
  const index = new Map<string, StorybookRecoveryTarget>()
  for (const canonicalPath of routes) {
    const target = Object.freeze({canonicalPath, shellPath, pageId: page.id})
    register(index, canonicalPath, target)
    if (canonicalPath !== "/") {
      const compatiblePath = canonicalPath.endsWith("/")
        ? canonicalPath.slice(0, -1)
        : `${canonicalPath}/`
      register(index, compatiblePath, target)
    }
  }
  return index
}

export function storybookAppRecoveryIndex(app: StorybookAppManifest): ReadonlyMap<string, StorybookRecoveryTarget> {
  const index = new Map<string, StorybookRecoveryTarget>()
  for (const page of app.pages) {
    for (const [path, target] of storybookPageRecoveryIndex(app, page)) register(index, path, target)
  }
  return index
}

function register(
  index: Map<string, StorybookRecoveryTarget>,
  path: string,
  target: StorybookRecoveryTarget,
): void {
  const previous = index.get(path)
  if (previous !== undefined &&
    (previous.pageId !== target.pageId || previous.canonicalPath !== target.canonicalPath)) {
    throw new Error(`Storybook public route is owned by more than one page: ${path}`)
  }
  index.set(path, target)
}
