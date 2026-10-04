import {expect, test} from "bun:test"
import {join} from "node:path"
import Registry from "../index"
import {runCatalogWorker} from "../src/worker-client"

const fixture = join(import.meta.dir, "../../../../repo/discovery/fixtures/valid")

test("native worker принимает каталог атомарно и сохраняет объекты неизменённых пакетов", async () => {
  let invalidStyle = false
  const registry = new Registry(undefined, () => invalidStyle ? [{
    specifier: "@fixture/missing.css", path: join(fixture, "missing.css"), ownerRoot: fixture,
    ownerPackageJsonPath: join(fixture, "package.json"), contentDigest: "0".repeat(64),
  }] : [])
  try {
    const first = await registry.configure([fixture])
    expect(first.descriptors.length).toBeGreaterThan(0)
    registry.markDirty(fixture)
    const pending = registry.refreshIfNeeded()
    expect(registry.snapshot()).toEqual(first)
    const second = await pending
    expect(second.graph).toBe(first.graph)
    expect(second.descriptors).toBe(first.descriptors)
    expect(registry.metrics().resolverCalls).toBe(2)
    invalidStyle = true
    await expect(registry.refresh()).rejects.toThrow()
    expect(registry.snapshot()).toEqual(second)
  } finally { await registry.dispose() }
}, 15000)

test("заблокированный вычислением worker не задерживает HTTP и WebSocket родителя", async () => {
  const gate = new Int32Array(new SharedArrayBuffer(4))
  const started = Promise.withResolvers<void>()
  const controller = new AbortController()
  const server = Bun.serve({hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/events" && server.upgrade(request)) return
      return new Response("ready")
    },
    websocket: {message(socket, data) { socket.send(data) }},
  })
  const pending = runCatalogWorker(Object.assign({kind: "discover" as const, roots: []}, {gate}), controller.signal,
    () => started.resolve(), new URL("./fixture/blocked-worker.ts", import.meta.url))
  let socket: WebSocket | undefined
  try {
    await started.promise
    let completed = false
    void pending.then(() => { completed = true })
    const url = new URL("/events", server.url)
    url.protocol = "ws:"
    socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), {once: true})
      socket!.addEventListener("error", reject, {once: true})
    })
    for (let i = 0; i < 5; i++) {
      expect(await (await fetch(server.url, {signal: AbortSignal.timeout(1000)})).text()).toBe("ready")
      const response = new Promise<string>(resolve => socket!.addEventListener("message", event => resolve(String(event.data)), {once: true}))
      socket.send(`event-${i}`)
      expect(await response).toBe(`event-${i}`)
    }
    expect(completed).toBeFalse()
    Atomics.store(gate, 0, 1)
    Atomics.notify(gate, 0)
    expect(await pending).toMatchObject({kind: "discovered", catalog: {scopes: []}})
  } finally {
    controller.abort()
    await pending.catch(() => {})
    socket?.close()
    await server.stop(true)
  }
}, 10000)

test("отмена завершает даже занятый worker", async () => {
  const gate = new Int32Array(new SharedArrayBuffer(4))
  const started = Promise.withResolvers<void>()
  const controller = new AbortController()
  const pending = runCatalogWorker(Object.assign({kind: "discover" as const, roots: []}, {gate}), controller.signal,
    () => started.resolve(), new URL("./fixture/blocked-worker.ts", import.meta.url))
  const outcome = pending.then(value => ({value}), error => ({error}))
  await started.promise
  controller.abort(new Error("test cancellation"))
  expect(await outcome).toMatchObject({error: {message: "test cancellation"}})
}, 10000)
