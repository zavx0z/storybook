/**
No-HMR delivery for one repository-owned Storybook application.

Each page compiles independently on its first browser-asset request. Routing
accepts only nodes declared by the page route tree; the root page is not a
wildcard fallback for unknown suffixes.

@packageDocumentation
*/

import {
  defineStorybookApp,
  storybookAppPublicPath,
  storybookPagePublicMount,
  storybookPageRoutes,
  type StorybookAppManifest,
  type StorybookPageManifest,
  type StorybookStaticFile,
} from "./app.ts"
import {storybookBaseMetaName} from "./environment.ts"
import {buildStorybookBrowserPage, storybookAssetContentType} from "./internal/browser-build.ts"
import {storybookAppRecoveryIndex, storybookPageRecoveryIndex} from "./internal/routes.ts"
import {resolveStorybookStaticFiles} from "./internal/static-files.ts"
import {resolveStorybookRouteTree} from "./route-tree.ts"

export type StorybookPageDiagnostics = Readonly<{
  builds: number
}>

export type StorybookPage = Readonly<{
  id: string
  mountPath: string
  publicMountPath: string
  assetBasePath: string
  manifest: StorybookPageManifest
  routeTree: StorybookPageManifest["routeTree"]
  routes: readonly string[]
  readonly diagnostics: StorybookPageDiagnostics
  owns(pathname: string): boolean
  matches(pathname: string): boolean
  routeResponse(pathname: string): Promise<Response | null>
  htmlResponse(): Promise<Response>
  assetResponse(pathname: string): Promise<Response | null>
}>

export type StorybookHubServerOptions = Readonly<{
  app: StorybookAppManifest
  port: number
  hostname?: string
  staticFiles: readonly StorybookStaticFile[]
}>

/**
Creates one mountable page without opening a listener.

Browser code is built once, on demand, and remains namespaced below the page id.
Concurrent first requests share the same build.

@throws If `page` is not one of the exact manifests owned by `app`.
*/
export function createStorybookPage(app: StorybookAppManifest, page: StorybookPageManifest): StorybookPage {
  if (!app.pages.includes(page)) {
    throw new Error(`Storybook page must belong to the supplied app manifest: ${page.id}`)
  }
  const publicMountPath = storybookPagePublicMount(app, page)
  const assetBasePath = `${app.basePath}/@storybook-assets/${page.id}`
  const routes = storybookPageRoutes(app, page)
  const html = createPageHtml(app, page, assetBasePath)
  let builds = 0
  let built: Awaited<ReturnType<typeof buildStorybookBrowserPage>> | null = null
  let buildInFlight: Promise<Awaited<ReturnType<typeof buildStorybookBrowserPage>>> | null = null

  const ensureBuilt = (): Promise<Awaited<ReturnType<typeof buildStorybookBrowserPage>>> => {
    if (built !== null) return Promise.resolve(built)
    if (buildInFlight !== null) return buildInFlight
    builds += 1
    const pending = buildStorybookBrowserPage(page.entrypoint, {minify: false, sourcemap: "inline"})
      .then((next) => {
        built = next
        return next
      })
      .finally(() => {
        if (buildInFlight === pending) buildInFlight = null
      })
    buildInFlight = pending
    return pending
  }

  const htmlResponse = async (): Promise<Response> => new Response(await html, {
    headers: noCacheHeaders("text/html; charset=utf-8"),
  })

  return Object.freeze({
    id: page.id,
    mountPath: page.mountPath,
    publicMountPath,
    assetBasePath,
    manifest: page,
    routeTree: page.routeTree,
    routes,
    get diagnostics(): StorybookPageDiagnostics {
      return Object.freeze({builds})
    },
    owns(pathname: string): boolean {
      return ownsPublicMount(pathname, publicMountPath)
    },
    matches(pathname: string): boolean {
      return resolveStorybookRouteTree(page.routeTree, {pathname}, {basePath: publicMountPath}).kind === "match"
    },
    async routeResponse(pathname: string): Promise<Response | null> {
      if (!ownsPublicMount(pathname, publicMountPath)) return null
      const resolution = resolveStorybookRouteTree(page.routeTree, {pathname}, {basePath: publicMountPath})
      if (resolution.kind === "not-found") return notFound()
      if (resolution.redirect) {
        return new Response(null, {
          status: 308,
          headers: {location: resolution.canonicalPath, "cache-control": "no-cache"},
        })
      }
      return htmlResponse()
    },
    htmlResponse,
    async assetResponse(pathname: string): Promise<Response | null> {
      if (!pathname.startsWith(`${assetBasePath}/`)) return null
      const assetName = pathname.slice(assetBasePath.length + 1)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetName)) return notFound()
      if (assetName === "style.css") {
        return new Response(Bun.file(page.stylePath), {headers: noCacheHeaders("text/css; charset=utf-8")})
      }
      let assets: Awaited<ReturnType<typeof buildStorybookBrowserPage>>
      try {
        assets = await ensureBuilt()
      } catch (error) {
        return new Response(errorText(error), {
          status: 500,
          headers: noCacheHeaders("text/plain; charset=utf-8"),
        })
      }
      if (assetName === "entry.js") {
        return new Response(assets.entry, {
          headers: noCacheHeaders("text/javascript; charset=utf-8"),
        })
      }
      const asset = assets.chunks.get(assetName)
      if (asset === undefined) return notFound()
      const headers = noCacheHeaders(storybookAssetContentType(assetName, asset))
      return new Response(asset, {headers})
    },
  })
}

/**
Starts one no-HMR origin for all pages owned by `app`.

The function does not adopt an existing listener or infer ownership from a
port. The caller owns process selection, logging and shutdown.

@param options - An already selected hostname and port plus exact app-owned
static files.

@returns The Bun server owned by this call.

@throws If the app graph, static routes or listener options are invalid.
*/
export function startStorybookHubServer(options: StorybookHubServerOptions): ReturnType<typeof Bun.serve> {
  const app = defineStorybookApp(options.app)
  storybookAppRecoveryIndex(app)
  const hostname = options.hostname ?? "127.0.0.1"
  const pages = app.pages
    .map((page) => createStorybookPage(app, page))
    .sort((left, right) => right.publicMountPath.length - left.publicMountPath.length)
  const staticFiles = new Map(resolveStorybookStaticFiles(app, options.staticFiles)
    .map((file) => [file.publicPath, file.sourcePath] as const))

  return Bun.serve({
    hostname,
    port: options.port,
    development: {hmr: false},
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed()
      const pathname = new URL(request.url).pathname
      const staticPath = staticFiles.get(pathname)
      if (staticPath !== undefined) {
        const file = Bun.file(staticPath)
        if (!await file.exists()) return notFound()
        return new Response(file, {headers: noCacheHeaders(file.type.length === 0 ? null : file.type)})
      }
      const assetPrefix = `${app.basePath}/@storybook-assets/`
      if (pathname.startsWith(assetPrefix)) {
        for (const page of pages) {
          const response = await page.assetResponse(pathname)
          if (response !== null) return response
        }
        return notFound()
      }
      const page = pages.find((candidate) => candidate.owns(pathname))
      if (page === undefined) return notFound()
      return await page.routeResponse(pathname) ?? notFound()
    },
  })
}

async function createPageHtml(
  app: StorybookAppManifest,
  page: StorybookPageManifest,
  assetBasePath: string,
): Promise<string> {
  const bodyHtml = page.body.kind === "canvas"
    ? `<canvas id="${escapeHtml(page.body.canvasId)}"></canvas>`
    : await Bun.file(page.body.bodyHtmlPath).text()
  const publicMountPath = storybookPagePublicMount(app, page)
  const baseHref = publicMountPath === "" ? "/" : `${publicMountPath}/`
  const publicHomePath = storybookAppPublicPath(app, app.home.path)
  const pageRoot = storybookPageRoutes(app, page)[0]
  const home = pageRoot === publicHomePath ? "" : `<a class="storybook-home" data-storybook-home href="${escapeHtml(publicHomePath)}" aria-label="${escapeHtml(app.home.ariaLabel)}">${escapeHtml(app.home.label)}</a>`
  const meta = (app.head?.meta ?? []).map((entry) => {
    const content = entry.kind === "value" ? entry.content : storybookAppPublicPath(app, entry.path)
    return `<meta name="${escapeHtml(entry.name)}" content="${escapeHtml(content)}">`
  }).join("\n    ")
  const restore = createRestoreScript(app, page)
  return `<!doctype html>
<html lang="ru" data-storybook-app="${escapeHtml(app.id)}" data-storybook-page="${escapeHtml(page.id)}">
  <head>
    <meta charset="utf-8">
    <base href="${escapeHtml(baseHref)}">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="${escapeHtml(storybookBaseMetaName(app.id))}" content="${escapeHtml(app.basePath)}">
    ${meta}
    ${restore}
    <meta http-equiv="cache-control" content="no-cache">
    <link rel="icon" href="data:,">
    <title>${escapeHtml(page.title)}</title>
    <link rel="stylesheet" href="${escapeHtml(`${assetBasePath}/style.css`)}">
    <style>
      .storybook-footer,
      .storybook-home {
        position: fixed;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 3px;
        background: rgba(35, 35, 35, 0.94);
        color: rgba(255, 255, 255, 0.9);
        font: 600 12px/1 monospace;
        letter-spacing: 0.02em;
        text-decoration: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      }
      .storybook-footer a {
        color: #76d2fb;
        text-decoration: none;
      }
      .storybook-footer {
        left: 10px;
        bottom: 10px;
        color: rgba(255, 255, 255, 0.7);
      }
      .storybook-home {
        right: 10px;
        bottom: 10px;
      }
      .storybook-footer a:hover,
      .storybook-footer a:focus-visible,
      .storybook-home:hover,
      .storybook-home:focus-visible {
        color: #bdeaff;
        outline: 1px solid rgba(96, 165, 250, 0.65);
      }
    </style>
  </head>
  <body data-storybook-capability="${escapeHtml(page.capability)}">
    ${home}
    ${bodyHtml}
    <footer class="storybook-footer" data-storybook-footer>
      ${escapeHtml(app.footer.lead)}&nbsp;<a href="${escapeHtml(app.footer.owner.href)}">${escapeHtml(app.footer.owner.label)}</a>&nbsp;· ${escapeHtml(app.footer.detail)}
    </footer>
    <script type="module" src="${escapeHtml(`${assetBasePath}/entry.js`)}"></script>
  </body>
</html>`
}

function createRestoreScript(app: StorybookAppManifest, page: StorybookPageManifest): string {
  const routes = Object.fromEntries([...storybookPageRecoveryIndex(app, page)]
    .map(([path, target]) => [path, target.canonicalPath]))
  const key = `${app.id}-storybook-restore-v1`
  return `<script>
      (() => {
        const key = ${scriptJson(key)}
        const routes = ${scriptJson(routes)}
        const value = sessionStorage.getItem(key)
        if (value === null) return
        sessionStorage.removeItem(key)
        const url = new URL(value, location.origin)
        if (url.origin !== location.origin) return
        const canonicalPath = routes[url.pathname]
        if (canonicalPath === undefined) return
        history.replaceState(null, "", canonicalPath + url.search + url.hash)
      })()
    </script>`
}

function ownsPublicMount(pathname: string, mountPath: string): boolean {
  if (!pathname.startsWith("/") || pathname.includes("//")) return false
  if (mountPath === "") return true
  return pathname === mountPath || pathname.startsWith(`${mountPath}/`)
}

function noCacheHeaders(contentType: string | null): Record<string, string> {
  return contentType === null
    ? {"cache-control": "no-cache"}
    : {"cache-control": "no-cache", "content-type": contentType}
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: noCacheHeaders("text/plain; charset=utf-8"),
  })
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: {...noCacheHeaders("text/plain; charset=utf-8"), allow: "GET, HEAD"},
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}
