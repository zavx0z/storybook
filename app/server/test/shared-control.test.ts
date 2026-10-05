import {afterEach, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createControl, {type StorybookAppControl} from "@zavx0z/storybook-app-control"
import createServerEnvironment from "../src/environment"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

test("управление выдаётся developer grant, streaming check и журнал используют одну команду и итог", async () => {
  const project = await mkdtemp(join(tmpdir(), "shared-control-"))
  cleanups.push(() => rm(project, {recursive: true, force: true}))
  const progress = [{phase: "compiling"}, {phase: "applying"}]
  const signals: AbortSignal[] = []
  const unavailable = async () => { throw new Error("Этот сценарий не вызывает данную операцию") }
  const controller: Awaited<ReturnType<StorybookAppControl.Input["controller"]>> = {
    ensure: unavailable, attach: unavailable, detach: unavailable, search: unavailable,
    open: unavailable, wait: unavailable, inspect: unavailable, interact: unavailable,
    capture: unavailable, close: unavailable, stop: unavailable, readResource: unavailable,
    async status() { return {status: "success", server: "running"} },
    async check(_input: unknown, context: {signal: AbortSignal, onProgress?: (value: Record<string, unknown>) => void | Promise<void>}) {
      signals.push(context.signal)
      for (const value of progress) await context.onProgress?.(value)
      return {status: "success", applied: true}
    },
  }
  const control = createControl({controller: () => controller})
  const journal: Record<string, unknown>[] = []
  const host = createServerEnvironment({project, projectName: () => "Project", entries: () => [],
    graph: () => ({nodes: []} as unknown as StorybookPackageGraphRead.Input),
    extensions: input => input.inspectExecutors ? control.tools : [],
    recordRequest: value => { journal.push(value) },
  })
  cleanups.push(() => host.dispose())
  const local = await host.assignExecutor({executorId: "local", address: "/"})
  const denied = await host.handle(new Request("http://localhost/environment", {
    method: "POST", headers: {authorization: `Bearer ${local.token}`},
    body: JSON.stringify({name: "storybook_status", arguments: {schemaVersion: 1}}),
  }))
  expect(denied.status).toBe(404)
  const authority = {origin: "http://127.0.0.1:12345", controlToken: "c".repeat(43)}
  const call = (command?: unknown, stream = false) => host.request(new Request(`${authority.origin}/api/environment`, {
    method: command === undefined ? "GET" : "POST",
    headers: {authorization: `Bearer ${authority.controlToken}`, ...(stream ? {accept: "application/x-ndjson"} : {})},
    ...(command === undefined ? {} : {body: JSON.stringify(command)}),
  }), authority)
  const bootstrap = (await (await call()).json()).result
  expect(bootstrap.tools.map((tool: {name: string}) => tool.name)).toContain("storybook_check")
  expect(bootstrap.tools.map((tool: {name: string}) => tool.name)).not.toContain("storybook_ensure")
  expect(bootstrap.tools.map((tool: {name: string}) => tool.name)).not.toContain("storybook_stop")
  const response = await call({name: "storybook_check", arguments: {schemaVersion: 1, scope: "@sample/a"}}, true)
  expect(response.headers.get("content-type")).toContain("application/x-ndjson")
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line))
  expect(events).toEqual([
    {type: "progress", progress: {phase: "compiling"}},
    {type: "progress", progress: {phase: "applying"}},
    {type: "result", result: {result: {status: "success", applied: true}}},
  ])
  expect(signals).toHaveLength(1)
  const check = journal.filter(value => value.tool === "storybook_check")
  expect(check.map(value => value.status)).toEqual(["running", "running", "running", "success"])
  expect(new Set(check.map(value => value.id)).size).toBe(1)
  expect(check[0]?.id).toBe(response.headers.get("x-request-id"))
  expect(check.every(value => value.agentId === "developer:project")).toBeTrue()
  const json = await call({name: "storybook_check", arguments: {schemaVersion: 1, scope: "@sample/a"}})
  expect(await json.json()).toEqual({result: {status: "success", applied: true}})
})
