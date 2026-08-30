#!/usr/bin/env bun

import {Client} from "@modelcontextprotocol/client"
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio"
import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"

const stdio = fileURLToPath(new URL("./stdio.ts", import.meta.url))
const roots = [
  "/Users/zavx0z/repozitarium/webxr-space",
  "/Users/zavx0z/repozitarium/renderer",
  "/Users/zavx0z/repozitarium/metafor",
  "/Users/zavx0z/repozitarium/storybook/fixtures/isolation",
]
const fixtureStory = "/Users/zavx0z/repozitarium/storybook/fixtures/isolation/packages/a/.storybook/story.ts"
const originalFixtureBytes = readFileSync(fixtureStory)
const originalFixtureSha = sha256File(fixtureStory)
assert(originalFixtureSha === "344c3e54e22da700f1b53ce96995863f079b73edacfa40129785599331ae1ff4",
  "fixture A did not start from the canonical bytes")

const {client} = await connect()
const opened: Record<string, Record<string, unknown>> = {}
let serverInstance = ""
let serverOrigin = ""
let captureResourceUri = ""
let fixtureWasAttached = false
let fixtureCleaned = false
try {
  const previous = await tool("storybook_status", {schemaVersion: 1, includeViews: true})
  fixtureWasAttached = arrayOrEmpty(previous.attachedRoots).some((root) =>
    root !== null && typeof root === "object" &&
    (root as Record<string, unknown>).canonicalId === "project:storybook-isolation")
  const ensured = await tool("storybook_ensure", {schemaVersion: 1, roots})
  serverInstance = text(ensured.instanceId, "server instance")
  serverOrigin = text(ensured.origin, "server origin identity")
  const status = await tool("storybook_status", {schemaVersion: 1, includeViews: true})
  assert(status.instanceId === serverInstance && status.origin === serverOrigin, "ensure/status origin identity mismatch")
  const checked = await tool("storybook_check", {
    schemaVersion: 1,
    scope: "@storybook-fixture/a",
    live: false,
    timeoutMs: 30_000,
  })
  assert(checked.ok === true, "fixture package check failed")
  const liveChecked = await tool("storybook_check", {
    schemaVersion: 1,
    scope: "@engine/core",
    live: true,
    timeoutMs: 30_000,
  })
  assert(liveChecked.ok === true && array(liveChecked.views).every((view) =>
    view !== null && typeof view === "object" &&
    (view as Record<string, unknown>).revisionMatches === true), "live Engine check did not activate exact revision")
  const searches = Object.fromEntries(await Promise.all([
    ["HTMLElement", undefined],
    ["Button", "@ui/components"],
    ["NodeEditor", undefined],
    ["coordinate system", "@engine/core"],
  ].map(async ([query, packageId]) => [query, await tool("storybook_search", {
    schemaVersion: 1,
    query,
    ...(packageId === undefined ? {} : {packageId}),
    limit: 20,
  })])))
  for (const [query, result] of Object.entries(searches)) {
    assert(array((result as Record<string, unknown>).results).length > 0, `${query} search returned no results`)
  }

  for (const [key, packageId, route] of [
    ["dom", "@zavx0z/dom", "dom/interfaces/document/tree/default"],
    ["ui", "@ui/components", "components/foundation/button/basic/contained"],
    ["node", "@nodes/editor", "editor/node-tree/live"],
    ["engine", "@engine/core", "space/coordinate-system/z-up"],
    ["a", "@storybook-fixture/a", "fixture/a/default"],
    ["b", "@storybook-fixture/b", "fixture/b/default"],
    ["c", "@storybook-fixture/c", "fixture/c/default"],
  ] as const) {
    opened[key] = await tool("storybook_open", {schemaVersion: 1, packageId, route})
    assert(opened[key]!.ready === true && opened[key]!.presented === true, `${key} view is not ready`)
    assert(opened[key]!.route === route, `${key} route identity mismatch`)
    const presented = await tool("storybook_wait", {
      schemaVersion: 1,
      viewId: text(opened[key]!.viewId, `${key} viewId`),
      condition: "presented",
      timeoutMs: 5_000,
    })
    assert(presented.reached === true, `${key} presented wait did not reach`)
  }
  const timedWait = await client.callTool({
    name: "storybook_wait",
    arguments: {
      schemaVersion: 1,
      viewId: text(opened.dom!.viewId, "DOM viewId"),
      condition: "presented",
      afterRevision: text(opened.dom!.revision, "DOM revision"),
      timeoutMs: 100,
    },
  })
  assert(timedWait.isError === true &&
    (timedWait.structuredContent as Record<string, unknown> | undefined)?.status === "timeout",
  "view-specific afterRevision wait did not time out")

  const inspections: Record<string, Record<string, unknown>> = {}
  for (const key of ["dom", "ui", "node", "engine"] as const) {
    inspections[key] = await tool("storybook_inspect", {
      schemaVersion: 1,
      viewId: text(opened[key]!.viewId, `${key} viewId`),
      include: ["state", "diagnostics", "console", "semantic", "canvas"],
      maxDepth: 8,
      limit: 200,
    })
    assert(array(inspections[key]!.consoleErrors).length === 0, `${key} console has errors`)
    const canvas = inspections[key]!.canvas
    assert(canvas !== null && typeof canvas === "object" && !Array.isArray(canvas), `${key} has no exact canvas`)
    assert((canvas as Record<string, unknown>).id === "external-storybook-canvas", `${key} projected a foreign canvas`)
    assert(!("canvases" in inspections[key]!), `${key} exposed a plural canvas projection`)
  }
  const timeOrigins = new Set(Object.values(inspections).map((value) => nestedNumber(value, "timeOrigin")))
  assert(timeOrigins.size === 4, "real package views do not have distinct realms")

  const uiButton = semanticNode(inspections.ui!, "button", "Output")
  for (const action of ["hover", "focus", "click"] as const) {
    await tool("storybook_interact", {
      schemaVersion: 1,
      viewId: text(opened.ui!.viewId, "UI viewId"),
      target: {nodeId: text(uiButton.nodeId, "UI button nodeId")},
      action,
      timeoutMs: 15_000,
    })
  }
  const interactedUi = await tool("storybook_inspect", {
    schemaVersion: 1,
    viewId: text(opened.ui!.viewId, "UI viewId"),
    include: ["state", "diagnostics", "console", "semantic"],
    maxDepth: 8,
    limit: 200,
  })
  const interactedButton = semanticNode(interactedUi, "button", "Output")
  const interactedStates = interactedButton.states
  assert(interactedUi.ready === true && interactedUi.presented === true, "UI action lost ready/presented state")
  assert(interactedStates !== null && typeof interactedStates === "object" &&
    (interactedStates as Record<string, unknown>).focused === true, "UI button did not remain focused")

  const captures: Record<string, Record<string, unknown>> = {}
  for (const [key, view, area] of [
    ["uiPreview", "ui", "preview"],
    ["rendererWorkbench", "dom", "workbench"],
    ["engineCanvas", "engine", "canvas"],
  ] as const) {
    captures[key] = await tool("storybook_capture", {
      schemaVersion: 1,
      viewId: text(opened[view]!.viewId, `${view} viewId`),
      area,
      failOnConsoleError: true,
      timeoutMs: 30_000,
    })
    assert(number(captures[key]!.width) > 0 && number(captures[key]!.height) > 0, `${key} capture is empty`)
    assert(captures[key]!.revision === opened[view]!.revision, `${key} capture revision mismatch`)
    assert(captures[key]!.route === opened[view]!.route, `${key} capture route mismatch`)
    assert(captures[key]!.graphDigest === opened[view]!.graphDigest, `${key} capture graph mismatch`)
  }
  captureResourceUri = text(captures.engineCanvas!.resourceUri, "capture resource")
  const captureResource = await client.readResource({uri: captureResourceUri})
  assert(captureResource.contents.some((content) => "blob" in content && content.blob.length > 100),
    "capture resource has no PNG")

  const initial = fixtureState(await tool("storybook_status", {schemaVersion: 1}), opened)
  emit("baseline", {
    serverInstance,
    serverOrigin,
    graphDigest: ensured.graphDigest,
    searches: Object.fromEntries(Object.entries(searches).map(([key, value]) => [
      key,
      array((value as Record<string, unknown>).results).length,
    ])),
    views: Object.fromEntries(Object.entries(opened).map(([key, value]) => [key, {
      viewId: value.viewId,
      revision: value.revision,
    }])),
    captures: Object.fromEntries(Object.entries(captures).map(([key, value]) => [key, captureMetadata(value)])),
    initial,
    priorViews: previous.views,
    priorAttachedRoots: previous.attachedRoots,
  })

  await checkpoint("READY_FOR_A_UPDATE")
  const updated = await tool("storybook_wait", {
    schemaVersion: 1,
    packageId: "@storybook-fixture/a",
    condition: "active",
    afterRevision: initial.a.revision,
    timeoutMs: 30_000,
  })
  const afterUpdate = fixtureState(await tool("storybook_status", {schemaVersion: 1}), opened)
  assert(afterUpdate.a.revision !== initial.a.revision, "A did not activate a new revision")
  assert(afterUpdate.b.revision === initial.b.revision && afterUpdate.c.revision === initial.c.revision,
    "B or C changed after A-only update")
  emit("updated", {updated, state: afterUpdate})

  await checkpoint("READY_FOR_A_FAILURE")
  const failed = await tool("storybook_wait", {
    schemaVersion: 1,
    packageId: "@storybook-fixture/a",
    condition: "failed",
    afterRevision: afterUpdate.a.revision,
    timeoutMs: 30_000,
  })
  const afterFailure = fixtureState(await tool("storybook_status", {schemaVersion: 1}), opened)
  assert(afterFailure.a.revision === afterUpdate.a.revision, "A lost lastWorking after failure")
  assert(afterFailure.a.diagnostics > 0, "A failure has no diagnostics")
  assert(afterFailure.b.revision === initial.b.revision && afterFailure.c.revision === initial.c.revision,
    "B or C changed after A failure")
  const visibleA = await tool("storybook_inspect", {
    schemaVersion: 1,
    viewId: text(opened.a!.viewId, "A viewId"),
    include: ["state", "diagnostics", "console", "semantic"],
    limit: 120,
  })
  assert(visibleA.ready === true, "A view stopped working after candidate failure")
  const failedLiveCheck = await client.callTool({
    name: "storybook_check",
    arguments: {
      schemaVersion: 1,
      scope: "@storybook-fixture/a",
      live: true,
      timeoutMs: 30_000,
    },
  })
  assert(failedLiveCheck.isError === true &&
    (failedLiveCheck.structuredContent as Record<string, unknown> | undefined)?.status === "failed",
  "live check accepted failed A candidate")
  emit("failed", {failed, state: afterFailure, visibleA: {ready: visibleA.ready, revision: visibleA.revision}})

  await checkpoint("READY_FOR_A_RECOVERY")
  const recovered = await tool("storybook_wait", {
    schemaVersion: 1,
    packageId: "@storybook-fixture/a",
    condition: "active",
    afterRevision: afterFailure.a.revision,
    timeoutMs: 30_000,
  })
  const finalState = fixtureState(await tool("storybook_status", {schemaVersion: 1}), opened)
  assert(finalState.a.revision !== afterFailure.a.revision, "A recovery did not activate")
  assert(finalState.a.diagnostics === 0, "A diagnostics did not clear")
  assert(finalState.b.revision === initial.b.revision && finalState.c.revision === initial.c.revision,
    "B or C changed during A recovery")
  assert(sha256File(fixtureStory) === originalFixtureSha, "fixture A was not restored byte-for-byte")

  await cleanupFixture()
  emit("recovered", {recovered, state: finalState})
} finally {
  if (sha256File(fixtureStory) !== originalFixtureSha) await Bun.write(fixtureStory, originalFixtureBytes)
  await cleanupFixture().catch(() => {})
  await client.close()
}

const reconnected = await connect()
try {
  const status = await call(reconnected.client, "storybook_status", {schemaVersion: 1, includeViews: true})
  assert(status.server === "running", "MCP disconnect stopped Storybook")
  assert(status.instanceId === serverInstance && status.origin === serverOrigin, "MCP reconnect changed server identity")
  const retainedCapture = await reconnected.client.readResource({uri: captureResourceUri})
  assert(retainedCapture.contents.some((content) => "blob" in content && content.blob.length > 100),
    "capture did not survive MCP reconnect")
  emit("complete", {server: status.server, origin: status.origin, instanceId: status.instanceId, views: status.views})
} finally {
  await reconnected.client.close()
}

async function cleanupFixture(): Promise<void> {
  if (fixtureCleaned) return
  for (const key of ["a", "b", "c"] as const) {
    const view = opened[key]
    if (view === undefined || view.reused === true) continue
    await tool("storybook_close", {schemaVersion: 1, viewId: text(view.viewId, `${key} viewId`)})
  }
  if (!fixtureWasAttached) await tool("storybook_detach", {schemaVersion: 1, scopeId: "storybook-isolation"})
  fixtureCleaned = true
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", stdio],
    cwd: "/tmp",
    env: getDefaultEnvironment(),
    stderr: "inherit",
  })
  const client = new Client(
    {name: "storybook-live-e2e", version: "1.0.0"},
    {versionNegotiation: {mode: "auto", probe: {timeoutMs: 2_000}}},
  )
  await client.connect(transport)
  return {client, transport}
}

async function tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return call(client, name, args)
}

async function call(
  owner: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await owner.callTool({name, arguments: args})
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`)
  if (result.structuredContent === undefined || result.structuredContent === null ||
    typeof result.structuredContent !== "object" || Array.isArray(result.structuredContent)) {
    throw new Error(`${name} returned no structured content`)
  }
  return result.structuredContent as Record<string, unknown>
}

async function checkpoint(name: string): Promise<void> {
  emit("checkpoint", {name})
  await new Promise<void>((resolvePromise, reject) => {
    const onData = (chunk: Buffer): void => {
      const value = chunk.toString("utf8").trim()
      if (value !== "continue") {
        reject(new Error(`Expected continue for ${name}, received ${value}`))
        return
      }
      resolvePromise()
    }
    process.stdin.once("data", onData)
  })
}

function fixtureState(status: Record<string, unknown>, opened: Record<string, Record<string, unknown>>) {
  const packages = array(status.packages) as Record<string, unknown>[]
  const read = (key: "a" | "b" | "c", packageId: string) => {
    const value = packages.find((candidate) => candidate.packageId === packageId)
    if (value === undefined) throw new Error(`Missing fixture package ${packageId}`)
    return {
      revision: text(value.activeRevision, `${key} revision`),
      failedRevision: typeof value.failedRevision === "string" ? value.failedRevision : null,
      diagnostics: array(value.diagnostics).length,
      viewId: text(opened[key]!.viewId, `${key} viewId`),
    }
  }
  return {
    a: read("a", "@storybook-fixture/a"),
    b: read("b", "@storybook-fixture/b"),
    c: read("c", "@storybook-fixture/c"),
  }
}

function semanticNode(value: Record<string, unknown>, role: string, name: string): Record<string, unknown> {
  const semantic = value.semantic
  if (semantic === null || typeof semantic !== "object") throw new Error("Inspection has no semantic projection")
  const matches = array((semantic as Record<string, unknown>).nodes).filter((candidate) =>
    candidate !== null && typeof candidate === "object" &&
    (candidate as Record<string, unknown>).role === role &&
    (candidate as Record<string, unknown>).name === name)
  if (matches.length !== 1) throw new Error(`Expected one semantic ${role} ${name}, received ${matches.length}`)
  return matches[0] as Record<string, unknown>
}

function nestedNumber(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] === "number") return value[key]
  if (value.state !== null && typeof value.state === "object" && typeof (value.state as Record<string, unknown>)[key] === "number") {
    return (value.state as Record<string, unknown>)[key] as number
  }
  throw new Error(`Missing numeric ${key}`)
}

function captureMetadata(value: Record<string, unknown>) {
  return {
    captureId: value.captureId,
    resourceUri: value.resourceUri,
    width: value.width,
    height: value.height,
    sha256: value.sha256,
    packageId: value.packageId,
    route: value.route,
    revision: value.revision,
    area: value.area,
  }
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array")
  return value
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${label}`)
  return value
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected number")
  return value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function emit(type: string, value: unknown): void {
  process.stdout.write(`${JSON.stringify({type, value})}\n`)
}
