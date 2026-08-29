#!/usr/bin/env bun

import {resolve} from "node:path"
import {inspectExternalStorybookServer} from "../src/external/server-state.ts"
import type {ExternalStorybookClientSnapshot} from "../src/external/browser/client-protocol.ts"

type JsonObject = Record<string, unknown>
type BrowserTarget = Readonly<{
  id: string
  title: string
  url: string
}>

const CHROME_ORIGIN = "http://127.0.0.1:7880"
const actions = new Set(["targets", "target", "open", "close", "reload", "dom", "console", "page", "canvas"])
const [action, scope, ...optionArgs] = Bun.argv.slice(2)
if (action === undefined || scope === undefined || !actions.has(action)) usage()
const options = parseOptions(optionArgs)
if (options.activate && action !== "open" && action !== "reload") usage()

const inspection = await inspectExternalStorybookServer()
if (inspection.state !== "running" || inspection.record === null) {
  fail("External Storybook server is not running; run `storybook serve` first")
}
const serverOrigin = inspection.record.origin
const targetUrl = await resolveStorybookUrl(serverOrigin, scope, options.route)
await chromeHealth()
let targets = await chromeTargets()
let candidates = candidateTargets(targets, serverOrigin, scope)

if (action === "targets") {
  output({action, scope, targetUrl, targets: candidates})
  process.exit(0)
}

if (action === "close") {
  const target = selectTarget(candidates, options.targetId)
  await chromeRequest(`/cdp/targets/${encodeURIComponent(target.id)}`, {method: "DELETE"})
  output({action, target})
  process.exit(0)
}

if (action === "open" && candidates.length === 0) {
  await createTarget(targetUrl)
  const deadline = Date.now() + 5_000
  do {
    targets = await chromeTargets()
    candidates = candidateTargets(targets, serverOrigin, scope)
    if (candidates.length > 0) break
    await Bun.sleep(100)
  } while (Date.now() < deadline)
}
const target = selectTarget(candidates, options.targetId)

if (action === "target") {
  output({action, scope, targetUrl, target})
  process.exit(0)
}

if (action === "open") {
  if (target.url !== targetUrl) await navigate(target, targetUrl)
  else await waitReady(target)
  const observed = await waitForStorybookDom(target)
  if (options.activate) await activate(target)
  output({action, activated: options.activate, target: observed})
} else if (action === "reload") {
  if (options.route !== undefined || target.url !== targetUrl) await navigate(target, targetUrl)
  else await chromeJson("/reload", {
    method: "POST",
    body: {targetId: target.id},
  })
  const observed = await waitForStorybookDom(target)
  if (options.activate) await activate(target)
  output({action, activated: options.activate, target: observed})
} else if (action === "dom") {
  output({action, target: await targetDom(target)})
} else if (action === "console") {
  const result = await chromeJson("/console", {
    method: "POST",
    body: {
      targetId: target.id,
      durationMs: options.durationMs,
    },
  })
  const entries = Array.isArray(result.entries) ? result.entries : []
  if (entries.some((entry) => isConsoleError(entry))) process.exitCode = 1
  output({action, target, durationMs: options.durationMs, entries})
} else if (action === "page") {
  const destination = resolve(options.output ?? fail("page requires --output <png>"))
  const response = await chromeRequest("/cdp/screenshot", {
    method: "POST",
    body: {
      targetId: target.id,
      format: "png",
      waitReady: true,
      caption: `Ожидаю увидеть готовый ${scope === "landing" ? "global landing" : `${scope} package Workbench`} на exact route`,
    },
  })
  if (!response.ok) fail(await response.text())
  await Bun.write(destination, await response.arrayBuffer())
  output({action, target, output: destination})
} else if (action === "canvas") {
  const destination = resolve(options.output ?? fail("canvas requires --output <png>"))
  const result = await chromeJson("/eval", {
    method: "POST",
    body: {
      targetId: target.id,
      js: `const canvases = [...document.querySelectorAll("canvas")]
        .filter((canvas) => !canvas.hidden && getComputedStyle(canvas).visibility !== "hidden")
      const canvas = canvases.find((candidate) => candidate.id !== "external-storybook-canvas")
        ?? canvases.find((candidate) => candidate.id === "external-storybook-canvas")
      if (!canvas) throw new Error("Storybook canvas not found")
      return canvas.toDataURL("image/png")`,
    },
  })
  const dataUrl = responseString(result)
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/u)
  if (match === null) fail("Storybook canvas returned no PNG data URL")
  await Bun.write(destination, Buffer.from(match[1]!, "base64"))
  output({action, target, output: destination, canvasBytes: Bun.file(destination).size})
}

async function resolveStorybookUrl(origin: string, scope: string, route: string | undefined): Promise<string> {
  if (scope === "landing") {
    if (route !== undefined) fail("landing does not accept --route")
    return new URL("/", origin).href
  }
  const response = await fetch(new URL("/api/client", origin), {signal: AbortSignal.timeout(5_000)})
  if (!response.ok) fail(`External Storybook client graph failed: ${response.status}`)
  const snapshot = await response.json() as ExternalStorybookClientSnapshot
  const path = route ?? ""
  const matches = snapshot.nodes.filter((node) => node.packageId === scope && node.routePath === path)
  if (matches.length === 0) fail(`Unknown external Storybook route: ${scope}:${path}`)
  if (matches.length > 1) fail(`Ambiguous external Storybook route: ${scope}:${path}`)
  return new URL(matches[0]!.urlPath, origin).href
}

async function chromeHealth(): Promise<void> {
  const response = await fetch(`${CHROME_ORIGIN}/health`, {signal: AbortSignal.timeout(3_000)})
  if (!response.ok) fail(`@meta/chrome health failed: ${response.status}`)
  const health = await response.json() as JsonObject
  if (health.ok !== true) fail(`@meta/chrome is not ready: ${JSON.stringify(health)}`)
  const cdp = health.cdp as JsonObject | undefined
  if (cdp?.available !== true) fail("@meta/chrome CDP is unavailable; start its canonical CDP Chrome")
}

async function chromeTargets(): Promise<JsonObject[]> {
  const value = await chromeJson("/cdp/targets")
  if (!Array.isArray(value.targets)) fail("@meta/chrome returned no CDP targets")
  return value.targets.filter((target): target is JsonObject =>
    target !== null && typeof target === "object" && !Array.isArray(target))
}

function candidateTargets(
  targets: readonly JsonObject[],
  storybookOrigin: string,
  scope: string,
): BrowserTarget[] {
  const packagePrefix = scope === "landing" ? null : `/packages/${encodeURIComponent(scope)}/`
  const candidates: BrowserTarget[] = []
  for (const target of targets) {
    if (target.type !== "page" || typeof target.targetId !== "string" || target.targetId.length === 0) continue
    const url = typeof target.url === "string" ? target.url : ""
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.origin !== storybookOrigin) continue
    if (packagePrefix === null ? !landingPath(parsed.pathname) : !parsed.pathname.startsWith(packagePrefix)) continue
    candidates.push(Object.freeze({
      id: target.targetId,
      title: typeof target.title === "string" ? target.title : "",
      url,
    }))
  }
  return candidates
}

function landingPath(pathname: string): boolean {
  return pathname === "/" || /^\/(?:projects|workspaces)\/[^/]+\/$/u.test(pathname)
}

async function createTarget(url: string): Promise<void> {
  await chromeJson("/cdp/targets", {method: "POST", body: {url}})
}

function selectTarget(candidates: readonly BrowserTarget[], targetId: string | undefined): BrowserTarget {
  if (targetId !== undefined) {
    const target = candidates.find(({id}) => id === targetId)
    if (target === undefined) fail(`Exact Storybook target not found: ${targetId}`)
    return target
  }
  if (candidates.length === 0) fail("Storybook target is not open; run browser open")
  if (candidates.length > 1) fail("Multiple Storybook targets are open; pass --target-id")
  return candidates[0]!
}

async function navigate(target: BrowserTarget, url: string): Promise<void> {
  await chromeJson("/navigate", {
    method: "POST",
    body: {targetId: target.id, url},
  })
}

async function activate(target: BrowserTarget): Promise<void> {
  await chromeJson(`/cdp/targets/${encodeURIComponent(target.id)}/activate`, {
    method: "POST",
  })
}

async function waitReady(target: BrowserTarget): Promise<void> {
  await chromeJson("/wait-ready", {
    method: "POST",
    body: {targetId: target.id},
  })
}

async function targetDom(target: BrowserTarget): Promise<JsonObject> {
  return chromeJson("/eval", {
    method: "POST",
    body: {
      targetId: target.id,
      js: `return {
        title: document.title,
        pathname: location.pathname,
        ready: document.documentElement.dataset.externalStorybook ?? null,
        landingState: document.documentElement.dataset.externalStorybookLanding ?? null,
        packageState: document.documentElement.dataset.externalStorybookPackage ?? null,
        packageId: document.documentElement.dataset.externalStorybookPackageId ?? null,
        route: document.documentElement.dataset.externalStorybookRoute ?? null,
        revision: document.documentElement.dataset.externalStorybookRevision ?? null,
        error: document.documentElement.dataset.externalStorybookError ?? null,
        timeOrigin: performance.timeOrigin,
        canvases: [...document.querySelectorAll("canvas")].map((canvas) => ({
          id: canvas.id,
          width: canvas.width,
          height: canvas.height,
          hidden: canvas.hidden,
        })),
      }`,
    },
  })
}

async function waitForStorybookDom(target: BrowserTarget): Promise<JsonObject> {
  const deadline = Date.now() + 10_000
  let observed = await targetDom(target)
  while (Date.now() < deadline) {
    const parsed = observed.parsed
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const ready = (parsed as JsonObject).ready
      if (ready === "ready" || ready === "error") return observed
    }
    await Bun.sleep(50)
    observed = await targetDom(target)
  }
  fail(`Storybook target did not reach a ready or error state: ${target.id}`)
}

async function chromeJson(
  path: string,
  options: Readonly<{method?: string, body?: unknown}> = {},
): Promise<JsonObject> {
  const response = await chromeRequest(path, options)
  const text = await response.text()
  if (!response.ok) fail(text || `@meta/chrome request failed: ${response.status}`)
  const value = JSON.parse(text) as unknown
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`@meta/chrome returned invalid JSON: ${path}`)
  }
  return value as JsonObject
}

function chromeRequest(
  path: string,
  options: Readonly<{method?: string, body?: unknown}>,
): Promise<Response> {
  return fetch(`${CHROME_ORIGIN}${path}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined ? {} : {
      headers: {"content-type": "application/json"},
      body: JSON.stringify(options.body),
    }),
    signal: AbortSignal.timeout(30_000),
  })
}

function responseString(result: JsonObject): string {
  if (typeof result.parsed === "string") return result.parsed
  if (typeof result.result !== "string") fail("@meta/chrome eval returned no string")
  try {
    const parsed = JSON.parse(result.result)
    return typeof parsed === "string" ? parsed : result.result
  } catch {
    return result.result
  }
}

function isConsoleError(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false
  const entry = value as JsonObject
  return entry.level === "error" || entry.type === "error"
}

function parseOptions(args: readonly string[]) {
  let route: string | undefined
  let targetId: string | undefined
  let outputPath: string | undefined
  let activate = false
  let durationMs = 1_500
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--activate") {
      activate = true
      continue
    }
    const value = args[index + 1]
    if (value === undefined) usage()
    if (argument === "--route") route = value
    else if (argument === "--target-id") targetId = value
    else if (argument === "--output") outputPath = value
    else if (argument === "--duration-ms") {
      durationMs = Number(value)
      if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 30_000) usage()
    } else usage()
    index += 1
  }
  return Object.freeze({route, targetId, output: outputPath, activate, durationMs})
}

function usage(): never {
  throw new Error(
    "Usage: storybook-browser.ts <targets|target|open|close|reload|dom|console|page|canvas> <landing|package-id> [--route <package-route>] [--target-id <window:tab>] [--output <png>] [--duration-ms <ms>] [--activate]",
  )
}

function output(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function fail(message: string): never {
  throw new Error(message)
}
