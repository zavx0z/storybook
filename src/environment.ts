/**
Browser public-path environment shared by repository-owned Storybook apps.

Each app derives a unique inert meta name from its own kebab-case id. The
module resolves public URLs below that injected mount without assuming a
repository name or deployment host.

@packageDocumentation
*/

/**
Returns the inert meta name used to inject one app's public mount.

@throws If `appId` is not lowercase kebab-case.
*/
export function storybookBaseMetaName(appId: string): string {
  validateStorybookAppId(appId)
  return `${appId}-storybook-base`
}

/**
Reads and normalizes the public mount injected for `appId`.

An absent or empty meta value denotes the origin root used by local development.

@throws If the injected value is not a normalized absolute mount.
*/
export function storybookBasePath(appId: string, documentRef: Document = document): string {
  const metaName = storybookBaseMetaName(appId)
  const value = documentRef.querySelector<HTMLMetaElement>(`meta[name="${metaName}"]`)?.content ?? ""
  return normalizeStorybookBasePath(value)
}

/**
Resolves one absolute app-local path below the injected public mount.

@param pathname - Normalized root-relative path, including the leading `/`.

@throws If `appId`, the injected mount or `pathname` is malformed.
*/
export function storybookPublicPath(
  appId: string,
  pathname: string,
  documentRef: Document = document,
): string {
  if (!pathname.startsWith("/") || pathname.includes("//") || /[?#]/.test(pathname)) {
    throw new Error(`Storybook public path must be normalized and absolute: ${pathname}`)
  }
  const basePath = storybookBasePath(appId, documentRef)
  return pathname === "/" ? `${basePath}/` || "/" : `${basePath}${pathname}`
}

/**
Normalizes the deployment mount without accepting compatibility spellings.

`""` and `"/"` both denote the origin root; a non-root mount begins with `/`
and never ends with it.

@throws If `value` is relative, contains an empty segment, query or fragment.
*/
export function normalizeStorybookBasePath(value: string): string {
  if (value === "" || value === "/") return ""
  if (!value.startsWith("/") || value.endsWith("/") || value.includes("//") || /[?#]/.test(value)) {
    throw new Error(`Storybook base path must be a normalized absolute mount: ${value}`)
  }
  return value
}

function validateStorybookAppId(value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Storybook app id must be lowercase kebab-case: ${value}`)
  }
}
