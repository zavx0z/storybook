import {randomUUID} from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs"
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {createExternalStorybookClientSnapshot} from "./browser/client-protocol.ts"
import {StorybookDependencyWatchCoordinator} from "./dependency-watch.ts"
import {externalStorybookArtifactRoot, createExternalStorybookServerRecord, externalStorybookServerStatePath, readExternalStorybookServerRecord, writeExternalStorybookServerRecord, type ExternalStorybookServerRecord} from "./server-state.ts"
import {ExternalStorybookRegistry, type ExternalStorybookRegistrySnapshot} from "./registry.ts"
import {createStorybookPackageRevisionBuilder} from "./package-build.ts"
import {ExternalStorybookSessionManager} from "./session-manager.ts"
import {externalStorybookNode, resolveExternalStorybookRoute} from "./graph.ts"
import type {StorybookPackageEvent} from "./package-session.ts"

type StorybookWebSocketData = {
  subscriptions: Set<string>
  unsubscribers: Map<string, () => void>
}

export type ExternalStorybookServerOptions = Readonly<{
  declarations?: readonly string[]
  hostname?: string
  port?: number
  toolRoot?: string
  statePath?: string
  artifactRoot?: string
  landingEntryPath?: string
  fallbackEntryPath?: string
  packageBrowserEntryPath?: string
  writeServerRecord?: typeof writeExternalStorybookServerRecord
}>

export type ExternalStorybookRunningServer = Readonly<{
  origin: string
  record: ExternalStorybookServerRecord
  registry: ExternalStorybookRegistry
  sessions: ExternalStorybookSessionManager
  server: Bun.Server<StorybookWebSocketData>
  stopped: Promise<void>
  stop(): void
}>

/** Starts the one external Storybook HTTP/WebSocket process on an automatic port. */
export async function startExternalStorybookServer(
  options: ExternalStorybookServerOptions = {},
): Promise<ExternalStorybookRunningServer> {
  const toolRoot = realpathSync(options.toolRoot ?? fileURLToPath(new URL("../../", import.meta.url)))
  const statePath = resolve(options.statePath ?? externalStorybookServerStatePath())
  const artifactRoot = resolve(options.artifactRoot ?? externalStorybookArtifactRoot())
  const writeServerRecord = options.writeServerRecord ?? writeExternalStorybookServerRecord
  mkdirSync(artifactRoot, {recursive: true})
  const registry = new ExternalStorybookRegistry()
  if ((options.declarations?.length ?? 0) > 0) await registry.attachMany(options.declarations!)
  const clients = new Set<Bun.ServerWebSocket<StorybookWebSocketData>>()
  const watch = new StorybookDependencyWatchCoordinator()
  let serverRecord: ExternalStorybookServerRecord
  let stoppedResolve: () => void
  const stopped = new Promise<void>((resolvePromise) => {
    stoppedResolve = resolvePromise
  })
  let closing = false
  let structuralRefresh: Promise<void> | null = null
  let sharedAssets: Promise<SharedBrowserAssets> | null = null

  const publish = (event: StorybookPackageEvent | RegistryEvent | OpenEvent): number => {
    const browserEvent = event.type === "package.failed"
      ? sanitizePackageFailure(event, registry, () => sessions.snapshots())
      : event
    const payload = JSON.stringify(browserEvent)
    let delivered = 0
    for (const client of clients) {
      if (!matchesSubscription(client.data.subscriptions, event)) continue
      try {
        client.send(payload)
        delivered += 1
      } catch (error) {
        console.error("External Storybook WebSocket publication failed", error)
      }
    }
    return delivered
  }
  const sessions = new ExternalStorybookSessionManager({
    artifactRoot,
    buildRevision: createStorybookPackageRevisionBuilder({
      ...(options.packageBrowserEntryPath === undefined
        ? {}
        : {browserEntryPath: options.packageBrowserEntryPath}),
    }),
    watch,
    publish,
  })
  sessions.sync(registry.packageDescriptors())

  const refreshStructuralWatch = (): void => {
    const snapshot = registry.snapshot()
    const paths = snapshot.graph.nodes.flatMap((node) => [
      node.source.path,
      ...(node.readmePath === null ? [] : [node.readmePath]),
      ...node.resources.map(({path}) => path),
    ])
    watch.replace("__registry__", [...new Set(paths)], () => {
      if (structuralRefresh !== null) return
      structuralRefresh = refreshRegistry().finally(() => {
        structuralRefresh = null
      })
    })
  }

  const commitRegistry = (snapshot: ExternalStorybookRegistrySnapshot): void => {
    const nextRecord = Object.freeze({
      ...serverRecord,
      attachedDeclarations: Object.freeze(snapshot.entries.map(({declarationPath}) => declarationPath)),
    })
    writeServerRecord(statePath, nextRecord)
    refreshStructuralWatch()
    sessions.sync(registry.packageDescriptors())
    serverRecord = nextRecord
    publish(Object.freeze({
      type: "registry.updated",
      revision: snapshot.revision,
      graphDigest: snapshot.graph.digest,
    }))
  }

  const mutateRegistry = async (
    operation: () => Promise<ExternalStorybookRegistrySnapshot>,
  ): Promise<ExternalStorybookRegistrySnapshot> => {
    const before = registry.snapshot()
    const beforeRecord = serverRecord
    try {
      const snapshot = await operation()
      commitRegistry(snapshot)
      return snapshot
    } catch (error) {
      if (registry.snapshot().revision !== before.revision || registry.snapshot().graph !== before.graph) {
        registry.restore(before)
        try {
          writeServerRecord(statePath, beforeRecord)
          refreshStructuralWatch()
          sessions.sync(registry.packageDescriptors())
          serverRecord = beforeRecord
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "External Storybook registry rollback failed")
        }
      }
      throw error
    }
  }

  const refreshRegistry = async (): Promise<void> => {
    try {
      await mutateRegistry(() => registry.refresh())
    } catch (error) {
      publish(Object.freeze({
        type: "registry.failed",
        message: errorText(error),
      }))
    }
  }

  let server!: Bun.Server<StorybookWebSocketData>
  server = Bun.serve<StorybookWebSocketData>({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    fetch: async (request, currentServer) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/events") {
        if (currentServer.upgrade(request, {data: {subscriptions: new Set(), unsubscribers: new Map()}})) return
        return responseJson({error: "WebSocket upgrade failed"}, 400)
      }
      try {
        if (url.pathname === "/api/health" && request.method === "GET") {
          return responseJson({
            ok: true,
            protocol: "external-storybook-server/1",
            origin: server.url.origin,
            registryRevision: registry.snapshot().revision,
            graphDigest: registry.snapshot().graph.digest,
          })
        }
        if (url.pathname === "/api/status" && request.method === "GET") {
          const snapshot = registry.snapshot()
          return responseJson({
            ok: true,
            origin: server.url.origin,
            entries: snapshot.entries,
            graphDigest: snapshot.graph.digest,
            packages: sessions.snapshots(),
          })
        }
        if (url.pathname === "/api/client" && request.method === "GET") {
          const snapshot = registry.snapshot()
          return responseJson(createExternalStorybookClientSnapshot(snapshot.graph, sessions.snapshots()))
        }
        if (url.pathname === "/api/attach" && request.method === "POST") {
          const body = await requestObject(request)
          const path = requiredText("attach path", body.path)
          const snapshot = await mutateRegistry(() => registry.attach(path, "cli"))
          return responseJson({ok: true, entry: snapshot.entries.at(-1), graphDigest: snapshot.graph.digest})
        }
        if (url.pathname === "/api/detach" && request.method === "POST") {
          const body = await requestObject(request)
          const scopeId = requiredText("detach scopeId", body.scopeId)
          const snapshot = await mutateRegistry(() => registry.detach(scopeId))
          return responseJson({ok: true, graphDigest: snapshot.graph.digest})
        }
        if (url.pathname === "/api/check" && request.method === "POST") {
          const body = await requestObject(request)
          const scope = body.scope === undefined || body.scope === null
            ? null
            : requiredText("check scope", body.scope)
          const packageIds = resolveCheckPackages(registry.snapshot(), scope)
          const results = await Promise.all(packageIds.map((packageId) => sessions.ensure(packageId)))
          const ok = results.every(({buildState, activeRevision}) => buildState === "ready" && activeRevision !== null)
          return responseJson({ok, packages: results}, ok ? 200 : 422)
        }
        if (url.pathname === "/api/open" && request.method === "POST") {
          const body = await requestObject(request)
          const packageId = requiredText("open packageId", body.packageId)
          const route = body.route === undefined || body.route === ""
            ? ""
            : requiredText("open route", body.route)
          const resolvedRoute = resolveExternalStorybookRoute(registry.snapshot().graph, packageId, route)
          const event = Object.freeze({
            type: "package.open" as const,
            packageId,
            route,
            urlPath: resolvedRoute.urlPath,
          })
          const delivered = publish(event)
          return responseJson({ok: true, delivered, url: new URL(resolvedRoute.urlPath, server.url).href})
        }
        if (url.pathname === "/api/stop" && request.method === "POST") {
          setTimeout(() => close(), 25)
          return responseJson({ok: true})
        }
        if (url.pathname.startsWith("/__storybook/resources/nodes/") && request.method === "GET") {
          return resourceResponse(registry.snapshot(), url)
        }
        if (url.pathname.startsWith("/__storybook/revisions/") && request.method === "GET") {
          return revisionAssetResponse(sessions, url.pathname)
        }
        if (url.pathname.startsWith("/__storybook/shared/") && request.method === "GET") {
          const assets = await ensureSharedAssets()
          return fileInsideResponse(assets.root, url.pathname.slice("/__storybook/shared/".length))
        }
        if (url.pathname === "/assets/jetbrains-mono-bold.ttf" && request.method === "GET") {
          const fontPath = fileURLToPath(import.meta.resolve("@engine/core/fonts/jetbrains-mono-bold.ttf"))
          return fileResponse(fontPath, "font/ttf")
        }
        if (url.pathname === "/schemas/manifest.schema.json" || url.pathname === "/schemas/catalog.schema.json") {
          return fileResponse(join(toolRoot, url.pathname), "application/schema+json; charset=utf-8")
        }
        if (url.pathname.startsWith("/packages/") && request.method === "GET") {
          return packagePageResponse(url, registry, sessions, ensureSharedAssets)
        }
        if (request.method === "GET" && isLandingPath(registry.snapshot(), url.pathname)) {
          const assets = await ensureSharedAssets()
          return htmlResponse(storybookHtml("Storybook", `/__storybook/shared/${assets.landingEntry}`, "landing"))
        }
        return responseJson({error: "Unknown external Storybook route"}, 404)
      } catch (error) {
        return responseJson({error: errorText(error)}, statusForError(error))
      }
    },
    websocket: {
      open(websocket) {
        clients.add(websocket)
      },
      message(websocket, message) {
        try {
          const value = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as unknown
          if (value === null || typeof value !== "object") throw new Error("Subscription must be an object")
          const record = value as Record<string, unknown>
          if (record.type !== "subscribe") throw new Error("Unknown Storybook WebSocket message")
          const topic = requiredText("subscription topic", record.topic)
          if (topic !== "registry" && !topic.startsWith("package:")) {
            throw new Error(`Invalid Storybook subscription topic: ${topic}`)
          }
          if (topic.startsWith("package:") && !websocket.data.unsubscribers.has(topic)) {
            const packageId = topic.slice("package:".length)
            websocket.data.unsubscribers.set(topic, sessions.session(packageId).subscribe())
          }
          websocket.data.subscriptions.add(topic)
          websocket.send(JSON.stringify({type: "subscribed", topic}))
        } catch (error) {
          websocket.send(JSON.stringify({type: "subscription.failed", message: errorText(error)}))
        }
      },
      close(websocket) {
        for (const unsubscribe of websocket.data.unsubscribers.values()) unsubscribe()
        websocket.data.unsubscribers.clear()
        clients.delete(websocket)
      },
    },
  })

  serverRecord = createExternalStorybookServerRecord({
    toolRoot,
    origin: server.url.origin,
    attachedDeclarations: registry.snapshot().entries.map(({declarationPath}) => declarationPath),
  })
  writeServerRecord(statePath, serverRecord)
  refreshStructuralWatch()

  const ensureSharedAssets = (): Promise<SharedBrowserAssets> => {
    sharedAssets ??= buildSharedBrowserAssets({
      root: join(artifactRoot, "shared"),
      landingEntryPath: options.landingEntryPath ?? fileURLToPath(
        new URL("./browser/landing-entry.ts", import.meta.url),
      ),
      fallbackEntryPath: options.fallbackEntryPath ?? fileURLToPath(
        new URL("./browser/fallback-entry.ts", import.meta.url),
      ),
    })
    return sharedAssets
  }

  const close = (): void => {
    if (closing) return
    closing = true
    for (const client of clients) client.close(1001, "Storybook server stopped")
    clients.clear()
    sessions.dispose()
    watch.remove("__registry__")
    watch.dispose()
    server.stop(true)
    removeOwnedState(statePath, serverRecord)
    stoppedResolve!()
  }

  return Object.freeze({
    origin: server.url.origin,
    record: serverRecord,
    registry,
    sessions,
    server,
    stopped,
    stop: close,
  })
}

type RegistryEvent = Readonly<{
  type: "registry.updated"
  revision: number
  graphDigest: string
}> | Readonly<{
  type: "registry.failed"
  message: string
}>

type OpenEvent = Readonly<{
  type: "package.open"
  packageId: string
  route: string
  urlPath: string
}>

type SharedBrowserAssets = Readonly<{
  root: string
  landingEntry: string
  fallbackEntry: string
}>

async function buildSharedBrowserAssets(input: Readonly<{
  root: string
  landingEntryPath: string
  fallbackEntryPath: string
}>): Promise<SharedBrowserAssets> {
  const staging = `${input.root}.candidate-${randomUUID()}`
  rmSync(staging, {recursive: true, force: true})
  mkdirSync(staging, {recursive: true})
  const result = await Bun.build({
    entrypoints: [realpathSync(input.landingEntryPath), realpathSync(input.fallbackEntryPath)],
    outdir: staging,
    root: dirname(realpathSync(input.landingEntryPath)),
    naming: {entry: "[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"},
    publicPath: "/__storybook/shared/",
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: "external",
    loader: {".wgsl": "text"},
    metafile: true,
    throw: false,
  })
  if (!result.success) {
    rmSync(staging, {recursive: true, force: true})
    throw new Error(result.logs.map(({message}) => message).join("\n"))
  }
  const entryFor = (source: string): string => {
    const byName = result.outputs.find((artifact) =>
      artifact.kind === "entry-point" && basename(artifact.path).startsWith(basename(source, extname(source))))
    if (byName === undefined) throw new Error(`Shared Storybook entry was not emitted: ${source}`)
    return relative(staging, byName.path)
  }
  rmSync(input.root, {recursive: true, force: true})
  mkdirSync(dirname(input.root), {recursive: true})
  await Bun.write(join(staging, "manifest.json"), JSON.stringify({ok: true}))
  const landingEntry = entryFor(input.landingEntryPath)
  const fallbackEntry = entryFor(input.fallbackEntryPath)
  await import("node:fs/promises").then(({rename}) => rename(staging, input.root))
  return Object.freeze({root: input.root, landingEntry, fallbackEntry})
}

async function packagePageResponse(
  url: URL,
  registry: ExternalStorybookRegistry,
  sessions: ExternalStorybookSessionManager,
  ensureSharedAssets: () => Promise<SharedBrowserAssets>,
): Promise<Response> {
  const route = parsePackageRequest(url.pathname)
  const graph = registry.snapshot().graph
  const resolvedRoute = resolveExternalStorybookRoute(graph, route.packageId, route.routePath)
  if (resolvedRoute.urlPath !== url.pathname) {
    return new Response(null, {status: 308, headers: {location: resolvedRoute.urlPath}})
  }
  const snapshot = await sessions.ensure(route.packageId)
  if (snapshot.activeRevision === null || snapshot.entryRelativePath === null) {
    const assets = await ensureSharedAssets()
    return htmlResponse(storybookHtml(
      `${route.packageId} · Storybook`,
      `/__storybook/shared/${assets.fallbackEntry}`,
    ))
  }
  const session = sessions.session(route.packageId)
  const directory = session.revisionDirectory(snapshot.activeRevision)
  if (directory === null) throw new Error(`Active Storybook revision is missing: ${route.packageId}`)
  const script = `${revisionBase(route.packageId, snapshot.activeRevision)}${snapshot.entryRelativePath}`
  return htmlResponse(storybookHtml(`${route.packageId} · Storybook`, script))
}

function parsePackageRequest(pathname: string): Readonly<{packageId: string, routePath: string}> {
  const suffix = pathname.slice("/packages/".length)
  const slash = suffix.indexOf("/")
  if (slash < 0) throw new Error(`Malformed Storybook package route: ${pathname}`)
  const encodedPackage = suffix.slice(0, slash)
  let packageId: string
  try {
    packageId = decodeURIComponent(encodedPackage)
  } catch {
    throw new Error(`Malformed Storybook package identity: ${encodedPackage}`)
  }
  if (encodeURIComponent(packageId) !== encodedPackage) {
    throw new Error(`Non-canonical Storybook package identity: ${encodedPackage}`)
  }
  const encodedRoute = suffix.slice(slash + 1).replace(/\/$/u, "")
  const routePath = encodedRoute.length === 0
    ? ""
    : encodedRoute.split("/").map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (encodeURIComponent(decoded) !== segment || decoded === "." || decoded === "..") {
        throw new Error(`Non-canonical Storybook route segment: ${segment}`)
      }
      return decoded
    }).join("/")
  return Object.freeze({packageId, routePath})
}

function resourceResponse(snapshot: ExternalStorybookRegistrySnapshot, url: URL): Response {
  const pathname = url.pathname
  const suffix = pathname.slice("/__storybook/resources/nodes/".length)
  const [encoded, ...relativeSegments] = suffix.split("/")
  if (encoded === undefined || encoded.length === 0) throw new Error("Missing Storybook resource identity")
  const nodeId = decodeURIComponent(encoded)
  if (encodeURIComponent(nodeId) !== encoded) throw new Error(`Non-canonical Storybook resource identity: ${encoded}`)
  const node = externalStorybookNode(snapshot.graph, nodeId)
  const ownerRoot = resourceOwnerRoot(snapshot, node.id)
  const kind = url.searchParams.get("kind")
  if (kind !== null) {
    if ([...url.searchParams.keys()].some((key) => key !== "kind" && key !== "index")) {
      throw new Error("Unknown Storybook resource query")
    }
    if (!new Set(["fixture", "test", "media", "reference", "evidence", "asset"]).has(kind)) {
      throw new Error(`Unknown Storybook resource kind: ${kind}`)
    }
    const indexValue = url.searchParams.get("index") ?? "0"
    if (!/^(?:0|[1-9][0-9]*)$/u.test(indexValue)) throw new Error(`Invalid Storybook resource index: ${indexValue}`)
    const resources = node.resources.filter((resource) => resource.kind === kind)
    const resource = resources[Number(indexValue)]
    if (resource === undefined) return responseJson({error: "Unknown node resource"}, 404)
    const path = canonicalContainedFile(resource.path, ownerRoot)
    return path === null
      ? responseJson({error: "Unknown node resource"}, 404)
      : fileResponse(path, contentType(path))
  }
  if ([...url.searchParams.keys()].length > 0) throw new Error("Unknown Storybook README resource query")
  if (node.readmePath === null) return responseJson({error: "Node has no README"}, 404)
  if (relativeSegments.length === 0 || relativeSegments.every((segment) => segment.length === 0)) {
    const path = canonicalContainedFile(node.readmePath, ownerRoot)
    return path === null
      ? responseJson({error: "Unknown README resource"}, 404)
      : fileResponse(path, "text/markdown; charset=utf-8")
  }
  const decodedSegments = relativeSegments.filter(Boolean).map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (decoded.length === 0 || decoded === "." || decoded === ".." || decoded.includes("\\") ||
      encodeURIComponent(decoded) !== segment) {
      throw new Error(`Unsafe Storybook README resource path: ${pathname}`)
    }
    return decoded
  })
  const path = canonicalContainedFile(
    resolve(dirname(node.readmePath), ...decodedSegments),
    ownerRoot,
  )
  return path === null
    ? responseJson({error: "Unknown README resource"}, 404)
    : fileResponse(path, contentType(path))
}

function resourceOwnerRoot(snapshot: ExternalStorybookRegistrySnapshot, nodeId: string): string {
  let node = externalStorybookNode(snapshot.graph, nodeId)
  while (node.kind !== "workspace" && node.kind !== "project" && node.kind !== "package") {
    if (node.parentId === null) throw new Error(`Storybook resource node has no declaration owner: ${node.id}`)
    node = externalStorybookNode(snapshot.graph, node.parentId)
  }
  return realpathSync(dirname(dirname(node.source.path)))
}

function revisionAssetResponse(
  sessions: ExternalStorybookSessionManager,
  pathname: string,
): Response {
  const suffix = pathname.slice("/__storybook/revisions/".length)
  const [encodedPackage, revision, ...assetSegments] = suffix.split("/")
  if (encodedPackage === undefined || revision === undefined || assetSegments.length === 0) {
    return responseJson({error: "Malformed Storybook revision asset"}, 404)
  }
  const packageId = decodeURIComponent(encodedPackage)
  if (encodeURIComponent(packageId) !== encodedPackage || !/^[a-f0-9]{24}$/u.test(revision)) {
    throw new Error("Malformed Storybook revision identity")
  }
  const directory = sessions.session(packageId).revisionDirectory(revision)
  if (directory === null) return responseJson({error: "Unknown Storybook revision"}, 404)
  return fileInsideResponse(directory, assetSegments.join("/"))
}

function fileInsideResponse(root: string, encodedPath: string): Response {
  const segments = encodedPath.split("/").map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (decoded.length === 0 || decoded === "." || decoded === ".." || decoded.includes("\\") ||
      encodeURIComponent(decoded) !== segment) {
      throw new Error(`Unsafe Storybook asset path: ${encodedPath}`)
    }
    return decoded
  })
  const canonicalRoot = realpathSync(root)
  const path = canonicalContainedFile(resolve(canonicalRoot, ...segments), canonicalRoot)
  if (path === null) return responseJson({error: "Unknown Storybook asset"}, 404)
  return fileResponse(path, contentType(path))
}

function canonicalContainedFile(path: string, root: string): string | null {
  try {
    const canonicalRoot = realpathSync(root)
    const canonicalPath = realpathSync(path)
    if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`) || !statSync(canonicalPath).isFile()) return null
    return canonicalPath
  } catch {
    return null
  }
}

function isLandingPath(snapshot: ExternalStorybookRegistrySnapshot, pathname: string): boolean {
  if (pathname === "/") return true
  return snapshot.graph.nodes.some((node) =>
    (node.kind === "workspace" || node.kind === "project") && node.urlPath === pathname)
}

function resolveCheckPackages(
  snapshot: ExternalStorybookRegistrySnapshot,
  scope: string | null,
): readonly string[] {
  const all = snapshot.graph.nodes.filter(({kind}) => kind === "package").map(({packageId}) => packageId!)
  if (scope === null) return Object.freeze(all)
  if (all.includes(scope)) return Object.freeze([scope])
  const entry = snapshot.entries.find(({canonicalId}) =>
    canonicalId === scope || canonicalId.slice(canonicalId.indexOf(":") + 1) === scope || declarationPathMatches(scope, canonicalId, snapshot))
  if (entry === undefined) throw new Error(`Unknown Storybook check scope: ${scope}`)
  return Object.freeze(snapshot.graph.nodes
    .filter((node) => entry.descendantIds.includes(node.id) && node.kind === "package")
    .map(({packageId}) => packageId!))
}

function declarationPathMatches(
  scope: string,
  canonicalId: string,
  snapshot: ExternalStorybookRegistrySnapshot,
): boolean {
  if (!isAbsolute(scope)) return false
  const entry = snapshot.entries.find((candidate) => candidate.canonicalId === canonicalId)
  if (entry === undefined) return false
  try {
    return realpathSync(scope) === entry.declarationPath || realpathSync(join(scope, ".storybook", "manifest.json")) === entry.declarationPath
  } catch {
    return false
  }
}

function matchesSubscription(
  subscriptions: ReadonlySet<string>,
  event: StorybookPackageEvent | RegistryEvent | OpenEvent,
): boolean {
  if (event.type === "registry.updated" || event.type === "registry.failed" || event.type === "package.open") {
    return subscriptions.has("registry")
  }
  return subscriptions.has("registry") || subscriptions.has(`package:${event.packageId}`)
}

function sanitizePackageFailure(
  event: Extract<StorybookPackageEvent, {type: "package.failed"}>,
  registry: ExternalStorybookRegistry,
  snapshots: () => ReturnType<ExternalStorybookSessionManager["snapshots"]>,
): unknown {
  try {
    const summary = createExternalStorybookClientSnapshot(
      registry.snapshot().graph,
      snapshots(),
    ).packages.find(({packageId}) => packageId === event.packageId)
    return summary === undefined
      ? {type: event.type, packageId: event.packageId, diagnostics: []}
      : {type: event.type, packageId: event.packageId, diagnostics: summary.diagnostics}
  } catch {
    return {type: event.type, packageId: event.packageId, diagnostics: []}
  }
}

function revisionBase(packageId: string, revision: string): string {
  return `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`
}

function storybookHtml(title: string, script: string, entry: "landing" | null = null): string {
  return `<!doctype html>
<html lang="ru"${entry === null ? "" : ` data-external-storybook-entry="${entry}"`}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="engine-default-font" content="/assets/jetbrains-mono-bold.ttf">
    <title>${escapeHtml(title)}</title>
    <style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111}#external-storybook-canvas{display:block;width:100%;height:100%;touch-action:none}</style>
  </head>
  <body>
    <canvas id="external-storybook-canvas" aria-label="Storybook Workbench"></canvas>
    <script type="module" src="${escapeHtml(script)}"></script>
  </body>
</html>`
}

function responseJson(value: unknown, status = 200): Response {
  return Response.json(value, {status, headers: {"cache-control": "no-store"}})
}

function htmlResponse(value: string): Response {
  return new Response(value, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:",
    },
  })
}

function fileResponse(path: string, type: string): Response {
  if (!existsSync(path) || !statSync(path).isFile()) return responseJson({error: "File not found"}, 404)
  return new Response(Bun.file(path), {headers: {"content-type": type, "cache-control": "no-cache"}})
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (path.endsWith(".css")) return "text/css; charset=utf-8"
  if (path.endsWith(".json") || path.endsWith(".map")) return "application/json; charset=utf-8"
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "text/markdown; charset=utf-8"
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8"
  if (path.endsWith(".wasm")) return "application/wasm"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".ttf")) return "font/ttf"
  return "application/octet-stream"
}

async function requestObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json() as unknown
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storybook request body must be an object")
  }
  return value as Record<string, unknown>
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Storybook ${label} must be non-empty text`)
  }
  return value
}

function statusForError(error: unknown): number {
  const message = errorText(error)
  if (/Unknown|not found|does not exist|has no README/iu.test(message)) return 404
  if (/duplicate|ambiguous|already/iu.test(message)) return 409
  return 400
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function removeOwnedState(path: string, record: ExternalStorybookServerRecord): void {
  try {
    const current = readExternalStorybookServerRecord(path)
    if (current.pid === record.pid && current.processStart === record.processStart) unlinkSync(path)
  } catch {
    // A missing or foreign state file is never removed.
  }
}
