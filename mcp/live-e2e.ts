#!/usr/bin/env bun

/** Ручной MCP smoke для структурного каталога. Запускать только по отдельному поручению. */
import {Client} from "@modelcontextprotocol/client"
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio"
import {fileURLToPath} from "node:url"

const stdio = fileURLToPath(new URL("./stdio.ts", import.meta.url))
const roots = [
  "/Users/zavx0z/repozitarium/storybook",
  "/Users/zavx0z/repozitarium/webxr-space",
]
const packages = ["@zavx0z/storybook", "@zavx0z/ui", "@nodes/node"] as const
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["run", stdio],
  cwd: "/tmp",
  env: getDefaultEnvironment(),
  stderr: "inherit",
})
const client = new Client(
  {name: "storybook-structural-live-e2e", version: "1.0.0"},
  {versionNegotiation: {mode: "auto", probe: {timeoutMs: 2_000}}},
)
await client.connect(transport)
const createdViews: string[] = []
try {
  const prior = await call("storybook_status", {schemaVersion: 1, includeViews: true})
  const ensured = await call("storybook_ensure", {schemaVersion: 1, roots})
  const instanceId = text(ensured.instanceId, "instanceId")
  const origin = text(ensured.origin, "origin")
  const status = await call("storybook_status", {schemaVersion: 1, includeViews: true})
  assert(status.instanceId === instanceId && status.origin === origin, "Сервер сменился между ensure и status")

  const results: Record<string, unknown> = {}
  for (const packageId of packages) {
    const search = await call("storybook_search", {schemaVersion: 1, query: packageId, packageId, limit: 10})
    assert(array(search.results).length > 0, `Поиск не нашёл ${packageId}`)
    const candidate = await call("storybook_check", {schemaVersion: 1, scope: packageId, live: false, timeoutMs: 30_000})
    assert(candidate.ok === true, `Сборка ${packageId} не прошла`)
    const opened = await call("storybook_open", {schemaVersion: 1, packageId, route: ""})
    assert(opened.ready === true && opened.presented === true, `Обзор ${packageId} не показан`)
    const viewId = text(opened.viewId, "viewId")
    if (opened.reused !== true) createdViews.push(viewId)
    const inspection = await call("storybook_inspect", {
      schemaVersion: 1, viewId, include: ["state", "diagnostics", "console", "semantic", "canvas"],
      maxDepth: 8, limit: 150,
    })
    assert(array(inspection.diagnostics).length === 0, `Диагностика ${packageId} не пуста`)
    assert(array(inspection.consoleErrors).length === 0, `Консоль ${packageId} содержит ошибки`)
    const capture = await call("storybook_capture", {
      schemaVersion: 1, viewId, area: "workbench", failOnConsoleError: true, timeoutMs: 30_000,
    })
    assert(number(capture.width) > 0 && number(capture.height) > 0, `Снимок ${packageId} пуст`)
    results[packageId] = {viewId, revision: opened.revision, graphDigest: opened.graphDigest,
      captureId: capture.captureId, width: capture.width, height: capture.height}
  }
  process.stdout.write(`${JSON.stringify({type: "complete", instanceId, origin, priorViews: prior.views, results})}\n`)
} finally {
  for (const viewId of createdViews) {
    await call("storybook_close", {schemaVersion: 1, viewId}).catch(() => {})
  }
  await client.close()
}

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({name, arguments: args})
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`)
  const value = result.structuredContent
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}: ответ не содержит структуру`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Отсутствует ${label}`)
  return value
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Ожидался список")
  return value
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Ожидалось число")
  return value
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
