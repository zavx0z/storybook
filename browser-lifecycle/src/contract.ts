export type StorybookBrowserInteractionTarget = Readonly<{
  nodeId?: string | undefined
  role?: string | undefined
  name?: string | undefined
}>

export type StorybookBrowserInteractionValue =
  | string
  | number
  | Readonly<{key: string; modifiers?: readonly ("alt" | "ctrl" | "meta" | "shift")[] | undefined}>
  | Readonly<{text: string}>
  | Readonly<{deltaY: number; deltaX?: number | undefined; deltaZ?: number | undefined}>
  | Readonly<{dx: number; dy: number}>

export type StorybookBrowserInteractInput = Readonly<{
  viewId: string
  target?: StorybookBrowserInteractionTarget | undefined
  action: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: StorybookBrowserInteractionValue | undefined
  destination?: Readonly<{nodeId: string}> | undefined
  timeoutMs?: number | undefined
}>

export type StorybookBrowserCaptureInput = Readonly<{
  viewId?: string | undefined
  area: "page" | "workbench" | "preview" | "canvas" | "node"
  nodeId?: string | undefined
  failOnConsoleError?: boolean | undefined
  timeoutMs?: number | undefined
}>

export type ChromeTargetSummary = Readonly<{
  targetId: string
  type: string
  title: string
  url: string
}>

export type StorybookBridgeIdentity = Readonly<{
  protocol: "external-storybook-agent-bridge/1"
  packageId: string
  route: string
  revision: string | null
  graphDigest: string | null
  ready: boolean
  presented: boolean
  timeOrigin: number
  frameSequence?: number
}>

export type StorybookBridgeClip = Readonly<{
  x: number
  y: number
  width: number
  height: number
  scale?: number
}>

export type StorybookBridgeMethod = "identity" | "inspect" | "interact" | "capture"

export type StorybookInternalView = Readonly<{
  viewId: string
  targetId: string
  origin: string
  packageId: string
  route: string
  url: string
  title: string
}>

export type StorybookPublicView = Readonly<{
  viewId: string
  packageId: string
  route: string
  title: string
}>

export type StorybookChromeConsoleEntry = Readonly<{
  type?: string
  level?: string
  text?: string
  url?: string
  line?: number
  timestamp?: number
}>

export interface StorybookChromeClient {
  health(signal?: AbortSignal): Promise<void>
  cdpOrigin(signal?: AbortSignal): Promise<string>
  browserIdentity(signal?: AbortSignal): Promise<string>
  targets(signal?: AbortSignal): Promise<readonly ChromeTargetSummary[]>
  createTarget(url: string, signal?: AbortSignal): Promise<ChromeTargetSummary>
  closeTarget(targetId: string, signal?: AbortSignal): Promise<void>
  navigate(targetId: string, url: string, signal?: AbortSignal): Promise<void>
  waitReady(targetId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>
  consoleEntries(targetId: string, durationMs: number, signal?: AbortSignal): Promise<readonly StorybookChromeConsoleEntry[]>
  bridgeDiagnostics(targetId: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
  callBridge(targetId: string, method: StorybookBridgeMethod, params: unknown, signal?: AbortSignal): Promise<unknown>
  screenshot(
    targetId: string,
    options: Readonly<{caption: string; clip?: StorybookBridgeClip; timeoutMs?: number}>,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

export type StorybookProcessStart = (pid: number) => string | null

export type StorybookCaptureArea = "page" | "workbench" | "preview" | "canvas" | "node"

export type StorybookCaptureMetadata = Readonly<{
  packageId: string
  route: string
  graphDigest: string
  revision: string
  area: StorybookCaptureArea
  nodeId?: string
  consoleErrors: readonly unknown[]
}>

export type StoredStorybookCapture = StorybookCaptureMetadata & Readonly<{
  captureId: string
  resourceUri: string
  mimeType: "image/png"
  width: number
  height: number
  bytes: number
  sha256: string
  capturedAt: string
}>

/** Public URL segment; production package identity remains unchanged. */
export function storybookPackagePathSegment(packageId: string): string {
  if (typeof packageId !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageId)) {
    throw new Error(`Invalid Storybook package identity: ${packageId}`)
  }
  return packageId.replace(/^@/u, "").replace("/", "-")
}

/** Recognizes the readable URL and an older revision's encoded URL for an exact owner. */
export function storybookPackagePathMatches(segment: string, packageId: string): boolean {
  return segment === storybookPackagePathSegment(packageId) || segment === encodeURIComponent(packageId)
}

/** Public page pathname, separate from the internal directory navigation key. */
export function storybookPackageUrlPath(packageId: string, route = ""): string {
  const base = `/pkg-${storybookPackagePathSegment(packageId)}/`
  if (route.startsWith("dir-")) {
    if (route.includes("/")) throw new Error("Nested directory routes are not supported")
    return `${base}${route}`
  }
  return `${base}${route.split("/").map(encodeURIComponent).join("/")}`
}

/** Resolves a public pathname for a known owner, including pre-migration page paths. */
export function storybookPackageRouteFromPathname(pathname: string, packageId: string): string | null {
  const segments = pathname.split("/")
  const legacy = segments[1] === "packages"
  const offset = legacy ? 2 : 1
  const segment = segments[offset]
  if (segments[0] !== "" || segment === undefined ||
    !(legacy ? storybookPackagePathMatches(segment, packageId) : segment === `pkg-${storybookPackagePathSegment(packageId)}`)) return null
  const parts = segments.slice(offset + 1)
  const trailingSlash = parts.at(-1) === ""
  if (trailingSlash) parts.pop()
  if (parts.some(part => part.length === 0)) return null
  try {
    const decoded = parts.map(part => {
      const value = decodeURIComponent(part)
      if (encodeURIComponent(value) !== part || value === "." || value === ".." || value.includes("/") || value.includes("\\")) throw new Error("Invalid route segment")
      return value
    })
    if (!legacy && parts[0]?.startsWith("dir-")) {
      if (parts.length !== 1 || parts[0]!.length === 4) return null
      return parts.join("/")
    }
    return decoded.join("/")
  } catch {
    return null
  }
}

/** Translates a previously published directory key at the adapter boundary. */
export function storybookCurrentRouteKey(route: string): string {
  return route.startsWith("~directories/")
    ? route.slice("~directories/".length).split("/").map(segment => `dir-${segment}`).join("/")
    : route
}
