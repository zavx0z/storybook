import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createEnvironment, {type StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"
import readKnowledge from "@zavx0z/storybook-app-knowledge"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(onCall?: StorybookAppEnvironment.Input["onCall"], extensions?: StorybookAppEnvironment.Input["extensions"]) {
  const directory = await mkdtemp(join(tmpdir(), "environment-test-"))
  cleanups.push(() => rm(directory, {recursive: true, force: true}))
  for (const name of ["a", "b"]) {
    await mkdir(join(directory, name))
    await writeFile(join(directory, name, "file.txt"), name)
  }
  const knowledgeCalls: Parameters<StorybookAppEnvironment.Input["readKnowledge"]>[0][] = []
  const environment = createEnvironment({
    resolve(address) {
      if (address === "/") return {address, label: "Project", directory, type: "Project"}
      if (address !== "/a" && address !== "/b") throw new Error("Предмет отсутствует")
      return {address, label: address.slice(1), directory: join(directory, address.slice(1)), type: "Component"}
    },
    async readKnowledge(input) {
      knowledgeCalls.push(input)
      return readKnowledge(new Request("http://localhost/knowledge", {
        method: "POST",
        body: JSON.stringify(input.path === undefined ? {} : {path: input.path}),
        signal: input.signal,
      }), {
        projectName: "Project",
        entries: [
          {path: "a", description: "Предмет a", parent: null},
          {path: "a/detail", description: "Подробности a", parent: "a"},
          {path: "b", description: "Предмет b", parent: null},
        ],
        ...(input.address === "/" ? {} : {root: {path: input.address.slice(1)}}),
      })
    },
    ...(onCall === undefined ? {} : {onCall}),
    ...(extensions === undefined ? {} : {extensions}),
  })
  cleanups.push(() => environment.dispose())
  return {environment, directory, knowledgeCalls}
}

test("расширение владельца доступно только назначенному специалисту и сохраняет основу Package", async () => {
  const {environment} = await fixture(undefined, input => input.executorId !== "specialist" ? [] : [{
    name: "subject.report", description: "Отчёт предметного специалиста",
    inputSchema: {type: "object", properties: {}, additionalProperties: false},
    outputSchema: {type: "object"}, annotations: {readOnlyHint: true, destructiveHint: false},
    execute: () => ({executorId: input.executorId, address: input.subject.address, inspection: input.inspectExecutors}),
  }])
  const specialist = await environment.assign({executorId: "specialist", address: "/a"})
  const colleague = await environment.assign({executorId: "colleague", address: "/a"})
  expect(specialist.bootstrap.tools.map(tool => tool.name)).toContain("subject.report")
  expect(colleague.bootstrap.tools.map(tool => tool.name)).not.toContain("subject.report")
  const result = await environment.handle(request(specialist.token, {name: "subject.report", arguments: {}}))
  expect((await result.json()).result).toEqual({executorId: "specialist", address: "/a", inspection: false})
  expect((await environment.handle(request(colleague.token, {name: "subject.report", arguments: {}}))).status).toBe(404)
  const file = await environment.handle(request(specialist.token, {name: "filesystem.read", arguments: {path: "file.txt"}}))
  expect((await file.json()).result.content).toBe("a")
})

function request(token: string, command?: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/environment", {
    method: command === undefined ? "GET" : "POST",
    headers: {authorization: `Bearer ${token}`},
    ...(command === undefined ? {} : {body: JSON.stringify(command)}),
    ...(signal === undefined ? {} : {signal}),
  })
}

test("два исполнителя одного предмета имеют собственные назначения без MCP или процесса модели", async () => {
  const {environment, knowledgeCalls} = await fixture()
  const first = await environment.assign({executorId: "first", address: "/a"})
  const second = await environment.assign({executorId: "second", address: "/a"})
  expect(first.token).not.toBe(second.token)
  expect(first.bootstrap.executorId).toBe("first")
  expect(second.bootstrap.executorId).toBe("second")
  expect(first.bootstrap.subject).toEqual(second.bootstrap.subject)
  expect(first.bootstrap.tools).toEqual(second.bootstrap.tools)
  expect(knowledgeCalls).toHaveLength(0)
  const before = await environment.handle(request(first.token))
  expect((await before.json()).result).toEqual(first.bootstrap)
  expect(knowledgeCalls).toHaveLength(0)
  environment.revoke("first")
  expect((await environment.handle(request(first.token))).status).toBe(401)
  const response = await environment.handle(request(second.token, {name: "filesystem.read", arguments: {path: "file.txt"}}))
  expect((await response.json()).result).toMatchObject({path: "file.txt", content: "a"})
})

test("файловые scopes независимы и точный вызов сохраняет полноценные результаты AI", async () => {
  const {environment, directory} = await fixture()
  const a = await environment.assign({executorId: "a-worker", address: "/a"})
  const b = await environment.assign({executorId: "b-worker", address: "/b"})
  const content = '/Users/example/source\n{"packageRoot":"literal data","token":"literal content"}'
  const created = await environment.handle(request(a.token, {name: "filesystem.create", arguments: {path: "new.txt", content}}))
  expect(created.status).toBe(200)
  const read = await environment.handle(request(a.token, {name: "filesystem.read", arguments: {path: "new.txt"}}))
  expect((await read.json()).result.content).toBe(content)
  expect(await readFile(join(directory, "a/new.txt"), "utf8")).toBe(content)
  expect((await environment.handle(request(b.token, {name: "filesystem.read", arguments: {path: "new.txt"}}))).status).toBe(404)
  for (const path of ["../b/file.txt", join(directory, "b/file.txt")]) {
    expect((await environment.handle(request(a.token, {name: "filesystem.read", arguments: {path}}))).status).toBe(403)
  }
  const rejected = await environment.handle(request(a.token, {name: "filesystem.read", arguments: {path: "file.txt", root: directory}}))
  expect((await rejected.json()).error.code).toBe("INVALID_INPUT")
})

test("знания читаются лениво одним предметным reader без изменения области инструментов", async () => {
  const {environment, knowledgeCalls} = await fixture()
  const a = await environment.assign({executorId: "worker", address: "/a"})
  const root = await environment.handle(request(a.token, {name: "knowledge.read", arguments: {}}))
  expect((await root.json()).result).toEqual({description: "Предмет a", path: ".", children: [{description: "Подробности a", path: "./detail"}]})
  const detail = await environment.handle(request(a.token, {name: "knowledge.read", arguments: {path: "./detail"}}))
  expect((await detail.json()).result.description).toBe("Подробности a")
  expect(knowledgeCalls.map(call => ({address: call.address, path: call.path}))).toEqual([
    {address: "/a", path: undefined}, {address: "/a", path: "./detail"},
  ])
  const outside = await environment.handle(request(a.token, {name: "knowledge.read", arguments: {path: "../b"}}))
  expect(outside.ok).toBeFalse()
  const read = await environment.handle(request(a.token, {name: "filesystem.read", arguments: {path: "file.txt"}}))
  expect((await read.json()).result.content).toBe("a")
  const calls = knowledgeCalls.length
  const injected = await environment.handle(request(a.token, {name: "knowledge.read", arguments: {path: ".", address: "/b"}}))
  expect(injected.status).toBe(400)
  expect(knowledgeCalls).toHaveLength(calls)
})

test("глобальный разработчик читает Project и точный viewpoint без bearer цели", async () => {
  const {environment, knowledgeCalls} = await fixture()
  const worker = await environment.assign({executorId: "worker", address: "/a"})
  const developer = await environment.assign({executorId: "developer", address: "/", inspectExecutors: true})
  const snapshot = (await (await environment.handle(request(worker.token))).json()).result
  const inspected = await environment.handle(request(developer.token, {name: "environment.inspect", arguments: {executorId: "worker"}}))
  const value = (await inspected.json()).result
  expect(value).toEqual(snapshot)
  expect(JSON.stringify(value)).not.toContain(worker.token)
  expect(JSON.stringify(value)).not.toContain(developer.token)
  expect(value).not.toHaveProperty("token")
  expect(value.subject).not.toHaveProperty("directory")
  expect(value.tools.map((tool: {name: string}) => tool.name)).not.toContain("environment.inspect")
  const document = await environment.handle(request(developer.token, {name: "environment.inspect", arguments: {executorId: "worker", path: "./detail"}}))
  expect((await document.json()).result.document).toEqual({description: "Подробности a", path: "./detail", children: []})
  expect(knowledgeCalls.at(-1)).toMatchObject({address: "/a", path: "./detail"})
  const project = await environment.handle(request(developer.token, {name: "knowledge.read", arguments: {}}))
  expect((await project.json()).result.children.map((entry: {path: string}) => entry.path)).toEqual(["./a", "./b"])
  expect(knowledgeCalls.at(-1)?.address).toBe("/")
  const injected = await environment.handle(request(developer.token, {name: "environment.inspect", arguments: {executorId: "worker", path: ".", address: "/b"}}))
  expect(injected.status).toBe(400)
  const invalidPath = await environment.handle(request(developer.token, {name: "environment.inspect", arguments: {executorId: "worker", path: null}}))
  expect(invalidPath.status).toBe(400)
  const file = await environment.handle(request(developer.token, {name: "filesystem.read", arguments: {path: "b/file.txt"}}))
  expect((await file.json()).result.content).toBe("b")
  environment.revoke("worker")
  expect((await environment.handle(request(developer.token, {name: "environment.inspect", arguments: {executorId: "worker"}}))).status).toBe(404)
})

test("инспекция не выдаёт прочитанный документ отозванного или заменённого назначения цели", async () => {
  const {directory} = await fixture()
  const document = Promise.withResolvers<Response>()
  const reading = Promise.withResolvers<void>()
  const environment = createEnvironment({
    resolve: address => ({
      address,
      label: address,
      directory: address === "/" ? directory : join(directory, "a"),
      type: address === "/" ? "Project" : "Component",
    }),
    readKnowledge() {
      reading.resolve()
      return document.promise
    },
  })
  cleanups.push(() => environment.dispose())
  await environment.assign({executorId: "worker", address: "/a"})
  const developer = await environment.assign({executorId: "developer", address: "/", inspectExecutors: true})
  const response = environment.handle(request(developer.token, {name: "environment.inspect", arguments: {executorId: "worker", path: "."}}))
  await reading.promise
  environment.revoke("worker")
  await environment.assign({executorId: "worker", address: "/a"})
  document.resolve(Response.json({description: "Прочитано до отзыва"}))
  const result = await response
  expect(result.status).toBe(404)
  expect((await result.json()).error.code).toBe("NOT_FOUND")
})

test("права Project и локального исполнителя проверяются на стороне среды", async () => {
  const {environment} = await fixture()
  const worker = await environment.assign({executorId: "worker", address: "/a"})
  const project = await environment.assign({executorId: "project", address: "/"})
  for (const assignment of [worker, project]) {
    expect(assignment.bootstrap.tools.some(tool => tool.name === "environment.inspect")).toBeFalse()
    expect((await environment.handle(request(assignment.token, {name: "environment.inspect", arguments: {executorId: "worker"}}))).status).toBe(403)
  }
  await expect(environment.assign({executorId: "bad-inspector", address: "/a", inspectExecutors: true})).rejects.toMatchObject({code: "FORBIDDEN"})
  await expect(environment.assign({executorId: "worker", address: "/b"})).rejects.toMatchObject({code: "CONFLICT"})
  const invalid = await environment.handle(request(worker.token, {name: "filesystem.create", arguments: {path: "bad.txt", content: "x"}, executorId: "project"}))
  expect(invalid.status).toBe(400)
  expect((await environment.handle(request(worker.token, {name: "filesystem.stat", arguments: {path: "bad.txt"}}))).status).toBe(404)
})

test("неизвестный и старый bearer не создаёт fallback после нового назначения identity", async () => {
  const {environment} = await fixture()
  expect((await environment.handle(new Request("http://localhost/environment"))).status).toBe(401)
  expect((await environment.handle(request("unknown"))).status).toBe(401)
  const original = await environment.assign({executorId: "worker", address: "/a"})
  expect(environment.revoke("worker")).toBeTrue()
  expect(environment.revoke("worker")).toBeFalse()
  const replacement = await environment.assign({executorId: "worker", address: "/b"})
  expect((await environment.handle(request(original.token))).status).toBe(401)
  expect((await environment.handle(request(replacement.token))).status).toBe(200)
  environment.dispose()
  environment.dispose()
  expect((await environment.handle(request(replacement.token))).status).toBe(401)
  await expect(environment.assign({executorId: "new", address: "/a"})).rejects.toMatchObject({code: "ENVIRONMENT_CLOSED"})
})

test("отзыв подготавливаемого назначения исключает позднюю выдачу bearer", async () => {
  const subject = Promise.withResolvers<Awaited<ReturnType<StorybookAppEnvironment.Input["resolve"]>>>()
  const {directory} = await fixture()
  const environment = createEnvironment({resolve: () => subject.promise, readKnowledge: async () => Response.json({})})
  cleanups.push(() => environment.dispose())
  const pending = environment.assign({executorId: "worker", address: "/a"})
  await expect(environment.assign({executorId: "worker", address: "/a"})).rejects.toMatchObject({code: "CONFLICT"})
  expect(environment.revoke("worker")).toBeTrue()
  subject.resolve({address: "/a", label: "a", directory: join(directory, "a"), type: "Component"})
  await expect(pending).rejects.toMatchObject({code: "UNAUTHORIZED"})
})

test("id, принадлежность и результат события создаются средой, наблюдатель не меняет команду", async () => {
  const events: Parameters<NonNullable<StorybookAppEnvironment.Input["onCall"]>>[0][] = []
  const {environment} = await fixture(event => {
    events.push(structuredClone(event))
    if (event.phase === "running") (event.arguments as Record<string, unknown>).path = "other.txt"
    throw new Error("Наблюдатель недоступен")
  })
  const worker = await environment.assign({executorId: "worker", address: "/a"})
  const response = await environment.handle(request(worker.token, {name: "filesystem.read", arguments: {path: "file.txt"}}))
  expect((await response.json()).result.content).toBe("a")
  expect(events.map(event => event.phase)).toEqual(["running", "success"])
  expect(events[0]?.id).toBe(events[1]?.id)
  expect(response.headers.get("x-request-id")).toBe(events[0]!.id)
  expect(events[1]).toMatchObject({executorId: "worker", address: "/a", name: "filesystem.read", result: {content: "a"}})
  expect(JSON.stringify(events)).not.toContain(worker.token)
  expect(events.every(event => !Object.hasOwn(event, "cwd") && !Object.hasOwn(event, "token"))).toBeTrue()
  const unknown = await environment.handle(request(worker.token, {name: "unavailable", arguments: {}}))
  expect((await unknown.json()).error.code).toBe("UNKNOWN_TOOL")
  expect(events.at(-1)).toMatchObject({phase: "failed", error: {code: "UNKNOWN_TOOL"}})
})

test("Promise rejection наблюдателя и клиентская отмена не подменяют границы исполнения", async () => {
  const {environment} = await fixture(() => Promise.reject(new Error("Ошибка доставки события")))
  const worker = await environment.assign({executorId: "worker", address: "/a"})
  const successful = await environment.handle(request(worker.token, {name: "filesystem.read", arguments: {path: "file.txt"}}))
  expect(successful.status).toBe(200)
  const controller = new AbortController()
  controller.abort()
  const cancelled = await environment.handle(request(worker.token, {name: "filesystem.create", arguments: {path: "cancelled.txt", content: "x"}}, controller.signal))
  expect(cancelled.ok).toBeFalse()
  expect((await environment.handle(request(worker.token, {name: "filesystem.stat", arguments: {path: "cancelled.txt"}}))).status).toBe(404)
})

test("HTTP отклоняет query, неизвестные поля, методы и неверный JSON до вызова инструментов", async () => {
  const {environment, knowledgeCalls} = await fixture()
  const worker = await environment.assign({executorId: "worker", address: "/a"})
  const headers = {authorization: `Bearer ${worker.token}`}
  expect((await environment.handle(new Request("http://localhost/environment?path=outside", {headers}))).status).toBe(400)
  expect((await environment.handle(new Request("http://localhost/environment", {method: "DELETE", headers}))).status).toBe(405)
  for (const body of ["{broken", "{}", "[]", '{"name":"knowledge.read","arguments":null}', '{"name":"knowledge.read","arguments":{},"id":"own-id"}']) {
    expect((await environment.handle(new Request("http://localhost/environment", {method: "POST", headers, body}))).status).toBe(400)
  }
  const oversized = new Request("http://localhost/environment", {
    method: "POST", headers: {...headers, "content-length": "16777217"}, body: "{}",
  })
  expect((await environment.handle(oversized)).status).toBe(413)
  expect(knowledgeCalls).toHaveLength(0)
})
