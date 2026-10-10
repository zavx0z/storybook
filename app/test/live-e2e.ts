#!/usr/bin/env bun

/** Ручной REST smoke структурного каталога. Запускать только по отдельному поручению. */
import createApp from "@zavx0z/storybook-app"
import ServerState from "@zavx0z/storybook-app-server-state"
import {fileURLToPath} from "node:url"

const roots = [
  fileURLToPath(new URL("../../", import.meta.url)),
  fileURLToPath(new URL("../../../immersive", import.meta.url)),
]
const packages = ["@zavx0z/storybook", "@zavx0z/immersive/ui", "@zavx0z/immersive/nodes/node"] as const
const app = createApp()
const context = {signal: new AbortController().signal}
let endpoint: URL
let controlToken: string
const createdViews: string[] = []
try {
  // Только launcher запускает daemon; работающий REST endpoint не обеспечивает собственный ensure.
  const prior = await app.status({schemaVersion: 1, includeViews: true}, context)
  const ensured = await app.ensure({schemaVersion: 1, roots}, context)
  const record = ServerState.readExternalStorybookServerRecord(ServerState.externalStorybookServerStatePath())
  assert(record.instanceId === ensured.instanceId && record.origin === ensured.origin, "Authority не совпадает с обеспеченным сервером")
  endpoint = new URL("/api/environment", record.origin)
  controlToken = record.controlToken
  const bootstrap = await fetch(endpoint, {headers: {authorization: `Bearer ${controlToken}`}})
  assert(bootstrap.ok, "Общий вход среды не выдал bootstrap")
  const description = await bootstrap.json() as {result?: {tools?: {name: string}[]}}
  assert(description.result?.tools?.some(tool => tool.name === "storybook_search"), "Bootstrap не предоставил поиск Storybook")
  const instanceId = text(ensured.instanceId, "instanceId")
  const origin = text(ensured.origin, "origin")
  const status = await call("storybook_status", {schemaVersion: 1, includeViews: true})
  assert(status.instanceId === instanceId && status.origin === origin, "Сервер сменился между ensure и status")

  const results: Record<string, unknown> = {}
  for (const packageId of packages) {
    const search = await call("storybook_search", {schemaVersion: 1, query: packageId, packageId, limit: 10})
    assert(array(search.results).length > 0, `Поиск не нашёл ${packageId}`)
    const candidate = await call("storybook_check", {schemaVersion: 1, scope: packageId})
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
}

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: "POST", headers: {authorization: `Bearer ${controlToken}`, "content-type": "application/json"},
    body: JSON.stringify({name, arguments: args}), signal: context.signal,
  })
  const envelope = await response.json() as {result?: unknown, error?: unknown}
  if (!response.ok || envelope.error !== undefined) throw new Error(`${name}: ${JSON.stringify(envelope.error ?? envelope)}`)
  const value = envelope.result
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}: ответ не содержит структуру`)
  if ("status" in value && value.status !== "success") throw new Error(`${name}: ${JSON.stringify(value)}`)
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
