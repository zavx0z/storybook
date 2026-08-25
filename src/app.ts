/**
Typed application boundary for repository-owned Storybooks.

The manifest keeps page routing, browser entry files and evidence descriptors in
one owner-provided graph. Local file paths remain build inputs and are never
projected into the public static manifest.

@packageDocumentation
*/

import {isAbsolute} from "node:path"
import {DEFAULT_FONT_META_NAME} from "@engine/core/default-font"
import {
  normalizeStorybookBasePath,
  storybookBaseMetaName,
} from "./environment.ts"
import {
  storybookRouteTreeUrl,
  type StorybookRouteTree,
} from "./route-tree.ts"

export type StorybookCapability = "dom" | "svg" | "webgpu" | "webgpu-diagnostic"

export type StorybookReadinessDescriptor = Readonly<{
  /** Property in `document.documentElement.dataset`, published by the owner only after its first result. */
  dataset: string
  value: string
}>

export type StorybookCanvasDescriptor = Readonly<{
  /** Exact canvas inspected by route-specific browser evidence. */
  id: string
  evidence: "non-black"
}>

export type StorybookPageBody =
  | Readonly<{kind: "canvas"; canvasId: string}>
  | Readonly<{kind: "html"; bodyHtmlPath: string}>

export type StorybookPageManifest = Readonly<{
  id: string
  title: string
  mountPath: string
  entrypoint: string
  stylePath: string
  body: StorybookPageBody
  capability: StorybookCapability
  readiness: StorybookReadinessDescriptor
  canvas?: StorybookCanvasDescriptor
  routeTree: StorybookRouteTree<string>
}>

export type StorybookHomeDescriptor = Readonly<{
  path: string
  label: "Главная"
  ariaLabel: string
}>

export type StorybookFooterDescriptor = Readonly<{
  lead: "Создано для"
  owner: Readonly<{
    label: string
    href: string
  }>
  detail: string
}>

export type StorybookHeadMeta =
  | Readonly<{kind: "value"; name: string; content: string}>
  | Readonly<{kind: "public-path"; name: string; path: string}>

export type StorybookStaticFile = Readonly<{
  publicPath: string
  sourcePath: string
}>

export type StorybookAppManifest = Readonly<{
  id: string
  title: string
  basePath: string
  home: StorybookHomeDescriptor
  footer: StorybookFooterDescriptor
  head: Readonly<{
    meta: readonly StorybookHeadMeta[]
  }>
  pages: readonly StorybookPageManifest[]
}>

/**
Validates and freezes one repository Storybook application.

Every page must declare an exact route tree. WebGPU pages also declare the
canvas used by non-black evidence, while DOM and SVG pages cannot accidentally
claim that evidence contract.

@throws If identifiers, mounts, local files, evidence descriptors or page
ownership are ambiguous.
*/
export function defineStorybookApp(input: StorybookAppManifest): StorybookAppManifest {
  const id = validateKebabCase(input.id, "app id")
  storybookBaseMetaName(id)
  const title = validateVisibleText(input.title, "app title")
  const basePath = normalizeStorybookBasePath(input.basePath)
  const home = defineHome(input.home)
  const footer = defineFooter(input.footer)
  if (input.head === undefined) throw new Error("Storybook app must declare its Engine default font meta")
  const head = defineHead(input.head)
  if (head.meta.some((entry) => entry.name === storybookBaseMetaName(id))) {
    throw new Error(`Storybook app base meta is owned by the shell: ${storybookBaseMetaName(id)}`)
  }
  const fontMeta = head.meta.filter((entry) => entry.name === DEFAULT_FONT_META_NAME)
  if (fontMeta.length !== 1 || fontMeta[0]?.kind !== "public-path") {
    throw new Error(`Storybook app must declare one ${DEFAULT_FONT_META_NAME} public-path meta`)
  }
  if (input.pages.length === 0) throw new Error("Storybook app requires at least one page")

  const ids = new Set<string>()
  const mounts = new Set<string>()
  const pages = input.pages.map((page) => {
    const defined = definePage(page)
    if (ids.has(defined.id)) throw new Error(`Duplicate Storybook page id: ${defined.id}`)
    if (mounts.has(defined.mountPath)) throw new Error(`Duplicate Storybook page mount: ${defined.mountPath}`)
    ids.add(defined.id)
    mounts.add(defined.mountPath)
    return defined
  })
  if (!mounts.has("/")) throw new Error("Storybook app requires one root page mounted at /")

  const app = Object.freeze({
    id,
    title,
    basePath,
    home,
    footer,
    head,
    pages: Object.freeze(pages),
  }) satisfies StorybookAppManifest
  const knownRoutes = new Set(app.pages.flatMap((page) => storybookPageRoutes(app, page)))
  const publicHomePath = storybookAppPublicPath(app, home.path)
  if (!knownRoutes.has(publicHomePath)) {
    throw new Error(`Storybook home path must resolve to a registered route: ${home.path}`)
  }
  return app
}

/** Returns the app-local Engine font path that server and static delivery must provide. */
export function storybookDefaultFontPath(app: StorybookAppManifest): string {
  const meta = app.head.meta.find((entry) => entry.name === DEFAULT_FONT_META_NAME)
  if (meta?.kind !== "public-path") {
    throw new Error(`Storybook app does not declare ${DEFAULT_FONT_META_NAME} as a public path`)
  }
  return meta.path
}

/**
Prefixes one normalized app-local path with the public application base.

@throws If `pathname` is not an absolute path without query, hash or wildcard.
*/
export function storybookAppPublicPath(app: Pick<StorybookAppManifest, "basePath">, pathname: string): string {
  const normalized = normalizeAppPath(pathname, "public path")
  if (normalized === "/") return `${app.basePath}/` || "/"
  return `${app.basePath}${normalized}`
}

/** Returns the public mount used by routing and page assets. */
export function storybookPagePublicMount(
  app: Pick<StorybookAppManifest, "basePath">,
  page: Pick<StorybookPageManifest, "mountPath">,
): string {
  return page.mountPath === "/" ? app.basePath : `${app.basePath}${page.mountPath}`
}

/** Returns every canonical public overview and leaf owned by one page. */
export function storybookPageRoutes(
  app: Pick<StorybookAppManifest, "basePath">,
  page: Pick<StorybookPageManifest, "mountPath" | "routeTree">,
): readonly string[] {
  const basePath = storybookPagePublicMount(app, page)
  return Object.freeze(page.routeTree.nodes.map((node) => storybookRouteTreeUrl(page.routeTree, node.path, {basePath})))
}

function definePage(page: StorybookPageManifest): StorybookPageManifest {
  const id = validateKebabCase(page.id, "page id")
  const title = validateVisibleText(page.title, `page ${id} title`)
  const mountPath = normalizeMountPath(page.mountPath)
  const entrypoint = validateLocalFile(page.entrypoint, `page ${id} entrypoint`)
  const stylePath = validateLocalFile(page.stylePath, `page ${id} style`)
  const body = page.body.kind === "canvas"
    ? Object.freeze({kind: "canvas" as const, canvasId: validateHtmlId(page.body.canvasId, `page ${id} body canvas`)})
    : Object.freeze({kind: "html" as const, bodyHtmlPath: validateLocalFile(page.body.bodyHtmlPath, `page ${id} body`)})
  const readiness = Object.freeze({
    dataset: validateDatasetKey(page.readiness.dataset, `page ${id} readiness dataset`),
    value: validateVisibleText(page.readiness.value, `page ${id} readiness value`),
  })
  if (!["dom", "svg", "webgpu", "webgpu-diagnostic"].includes(page.capability)) {
    throw new Error(`Unknown Storybook page capability: ${String(page.capability)}`)
  }
  const webgpu = page.capability === "webgpu" || page.capability === "webgpu-diagnostic"
  if (webgpu && page.canvas === undefined) {
    throw new Error(`Storybook ${page.capability} page requires a non-black canvas descriptor: ${id}`)
  }
  if (!webgpu && page.canvas !== undefined) {
    throw new Error(`Storybook ${page.capability} page cannot declare WebGPU canvas evidence: ${id}`)
  }
  if (!webgpu && body.kind === "canvas") {
    throw new Error(`Storybook canvas body requires a WebGPU capability: ${id}`)
  }
  const canvas = page.canvas === undefined ? undefined : Object.freeze({
    id: validateHtmlId(page.canvas.id, `page ${id} evidence canvas`),
    evidence: page.canvas.evidence,
  })
  if (canvas !== undefined && canvas.evidence !== "non-black") {
    throw new Error(`Storybook canvas evidence must be non-black: ${id}`)
  }
  if (canvas !== undefined && body.kind === "canvas" && canvas.id !== body.canvasId) {
    throw new Error(`Storybook body and evidence canvas must use the same id: ${id}`)
  }
  if (page.routeTree.nodes.length === 0 || page.routeTree.find("")?.kind !== "overview") {
    throw new Error(`Storybook page route tree must contain its root overview: ${id}`)
  }
  return Object.freeze({
    id,
    title,
    mountPath,
    entrypoint,
    stylePath,
    body,
    capability: page.capability,
    readiness,
    ...(canvas === undefined ? {} : {canvas}),
    routeTree: page.routeTree,
  })
}

function defineHome(home: StorybookHomeDescriptor): StorybookHomeDescriptor {
  if (home.label !== "Главная") throw new Error("Storybook home label must be Главная")
  return Object.freeze({
    path: normalizeAppPath(home.path, "home path"),
    label: home.label,
    ariaLabel: validateVisibleText(home.ariaLabel, "home aria label"),
  })
}

function defineFooter(footer: StorybookFooterDescriptor): StorybookFooterDescriptor {
  if (footer.lead !== "Создано для") throw new Error("Storybook footer lead must be Создано для")
  const href = new URL(footer.owner.href)
  if (href.protocol !== "https:" && href.protocol !== "http:") {
    throw new Error(`Storybook footer owner href must be HTTP(S): ${footer.owner.href}`)
  }
  return Object.freeze({
    lead: footer.lead,
    owner: Object.freeze({
      label: validateVisibleText(footer.owner.label, "footer owner label"),
      href: href.href,
    }),
    detail: validateVisibleText(footer.detail, "footer detail"),
  })
}

function defineHead(head: Readonly<{meta: readonly StorybookHeadMeta[]}>): Readonly<{meta: readonly StorybookHeadMeta[]}> {
  const names = new Set<string>()
  const meta = head.meta.map((entry) => {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name)) {
      throw new Error(`Storybook meta name must be lowercase kebab-case: ${entry.name}`)
    }
    if (names.has(entry.name)) throw new Error(`Duplicate Storybook meta name: ${entry.name}`)
    names.add(entry.name)
    if (entry.kind === "value") {
      return Object.freeze({...entry, content: validateVisibleText(entry.content, `meta ${entry.name} content`)})
    }
    return Object.freeze({...entry, path: normalizeStaticPath(entry.path, `meta ${entry.name} public path`)})
  })
  return Object.freeze({meta: Object.freeze(meta)})
}

function validateKebabCase(value: string, label: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Storybook ${label} must be kebab-case: ${value}`)
  }
  return value
}

function validateVisibleText(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`Storybook ${label} cannot be empty`)
  return value
}

function validateLocalFile(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`Storybook ${label} must be an absolute local path: ${value}`)
  return value
}

function validateHtmlId(value: string, label: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(value)) throw new Error(`Storybook ${label} is not a valid HTML id: ${value}`)
  return value
}

function validateDatasetKey(value: string, label: string): string {
  if (!/^[a-z][A-Za-z0-9]*$/.test(value)) throw new Error(`Storybook ${label} must be a dataset property: ${value}`)
  return value
}

function normalizeMountPath(value: string): string {
  const normalized = normalizeAppPath(value, "page mount")
  if (normalized !== "/" && normalized.endsWith("/")) {
    throw new Error(`Storybook page mount cannot end in /: ${value}`)
  }
  return normalized
}

function normalizeStaticPath(value: string, label: string): string {
  const normalized = normalizeAppPath(value, label)
  if (normalized === "/" || normalized.endsWith("/")) {
    throw new Error(`Storybook ${label} must name one file: ${value}`)
  }
  return normalized
}

function normalizeAppPath(value: string, label: string): string {
  if (!value.startsWith("/") || value.includes("//") || /[?#*]/.test(value)) {
    throw new Error(`Storybook ${label} must be a normalized absolute pathname: ${value}`)
  }
  return value
}
