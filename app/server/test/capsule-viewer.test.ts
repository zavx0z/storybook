import {expect, test} from "bun:test"
import {createCapsuleViewerAccess} from "../src/capsule-viewer"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"

type Connection = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>["connections"][number]
const saved = {id: "qwen", label: "Qwen", enabled: true, provider: "capsule" as const,
  endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "qwen" as const}}
const running = {instanceId: "existing-1", profileName: "work", active: true, containerState: "running"}
const signal = () => new AbortController().signal
const ticket = (path: string) => new URL(path, "http://localhost").searchParams.get("ticket")!

function fixture() {
  let connections: readonly Connection[] = [saved]
  let sessions: object[] = [running]
  const requests: string[] = []
  const upstreams: FakeSocket[] = []
  const urls: string[] = []
  const access = createCapsuleViewerAccess({connections: async () => connections,
    fetch: (async (url, init) => {
      requests.push(String(url))
      expect(init?.redirect).toBe("error")
      expect(init?.method).toBeUndefined()
      return Response.json({ok: true, sessions})
    }),
    socket: url => {urls.push(url); const socket = new FakeSocket(); upstreams.push(socket); return socket as unknown as WebSocket},
  })
  return {access, requests, upstreams, urls, setConnections(value: readonly Connection[]) {connections = value}, setSessions(value: object[]) {sessions = value}}
}
class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING
  bufferedAmount = 0
  sent: string[] = []
  closed: number[] = []
  send(value: string) {this.sent.push(value)}
  close(code = 1000) {this.closed.push(code); this.readyState = WebSocket.CLOSED}
  open() {this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event("open"))}
  emit(data: unknown) {this.dispatchEvent(new MessageEvent("message", {data}))}
}
function client() {
  const sent: string[] = []
  const closed: number[] = []
  return {sent, closed, send(value: string) {sent.push(value)}, close(code = 1000) {closed.push(code)}, getBufferedAmount() {return 0}}
}

test("viewer читает только сохранённый origin и единственный запущенный профиль, одноразовый билет фиксирует instance", async () => {
  const f = fixture()
  try {
    await expect(f.access.open("http://elsewhere", signal())).rejects.toThrow("недоступно")
    expect(f.requests).toHaveLength(0)
    for (const sessions of [[], [{...running, active: false}], [{...running, containerState: "restarting"}], [running, {...running, instanceId: "another"}], [{...running, profileName: "other"}]]) {
      f.setSessions(sessions)
      await expect(f.access.open("qwen", signal())).rejects.toThrow("единственный")
    }
    f.setSessions([running])
    const opened = await f.access.open("qwen", signal())
    expect(opened).toMatchObject({instanceId: "existing-1", profile: "work"})
    expect(f.requests.every(value => value === "http://127.0.0.1:17777/api/studio/lifecycle/state")).toBeTrue()
    const relay = await f.access.consume(ticket(opened.socketPath), "viewer-1", signal())
    await expect(f.access.consume(ticket(opened.socketPath), "viewer-2", signal())).rejects.toThrow("использован")
    const receiver = client()
    relay.attach(receiver)
    expect(f.urls[0]).toBe("ws://127.0.0.1:17777/rtc/signaling?profile=existing-1&role=viewer&peer=viewer-1")
    const raw = ' {"type":"offer", "description":{"sdp":"sample"}} '
    relay.message(raw)
    const upstream = f.upstreams[0]!
    expect(upstream.sent).toEqual([])
    upstream.open()
    expect(upstream.sent).toEqual([raw])
    upstream.emit(raw)
    expect(receiver.sent).toEqual([raw])
    await relay.close()
    expect(upstream.closed).toEqual([1000])
    expect(receiver.closed).toEqual([1000])
  } finally {await f.access.dispose()}
})

test("ticket не разрешает изменённое подключение, instance, истёкший срок или некорректный peer", async () => {
  const f = fixture()
  try {
    const opened = await f.access.open("qwen", signal())
    await expect(f.access.consume(ticket(opened.socketPath), "viewer/escape", signal())).rejects.toThrow("peer")
    f.setSessions([{...running, instanceId: "replacement"}])
    await expect(f.access.consume(ticket(opened.socketPath), "viewer-1", signal())).rejects.toThrow("изменился")
    f.setSessions([running])
    const changed = await f.access.open("qwen", signal())
    f.setConnections([{...saved, enabled: false}])
    await expect(f.access.consume(ticket(changed.socketPath), "viewer-1", signal())).rejects.toThrow("отключено")
    expect(f.upstreams).toHaveLength(0)
  } finally {await f.access.dispose()}
  let now = 0
  const access = createCapsuleViewerAccess({connections: async () => [saved], now: () => now,
    fetch: (async () => Response.json({ok: true, sessions: [running]}))})
  try {
    const value = await access.open("qwen", signal())
    now = 30_000
    await expect(access.consume(ticket(value.socketPath), "viewer-1", signal())).rejects.toThrow("истёк")
  } finally {await access.dispose()}
})

test("binary, oversized frame, переполнение очереди и медленный получатель закрывают relay", async () => {
  for (const frame of [new Uint8Array([1]), "ж".repeat(32_769)]) {
    const f = fixture()
    try {
      const opened = await f.access.open("qwen", signal())
      const relay = await f.access.consume(ticket(opened.socketPath), "viewer-1", signal())
      const receiver = client()
      relay.attach(receiver)
      f.upstreams[0]!.open()
      relay.message(frame)
      expect(receiver.closed).toEqual([1009])
      expect(f.upstreams[0]!.sent).toEqual([])
    } finally {await f.access.dispose()}
  }
  const f = fixture()
  try {
    const opened = await f.access.open("qwen", signal())
    const relay = await f.access.consume(ticket(opened.socketPath), "viewer-1", signal())
    const receiver = client()
    relay.attach(receiver)
    for (let i = 0; i < 9; i++) relay.message("{}")
    expect(receiver.closed).toEqual([1009])
  } finally {await f.access.dispose()}
})

test("relay ограничивает upstream frames и буфер обоих читателей; settings save закрывает активное соединение", async () => {
  for (const direction of ["binary", "large", "client-buffer", "upstream-buffer", "save"] as const) {
    const f = fixture()
    try {
      const opened = await f.access.open("qwen", signal())
      const relay = await f.access.consume(ticket(opened.socketPath), "viewer-1", signal())
      const receiver = client()
      relay.attach({...receiver, getBufferedAmount: () => direction === "client-buffer" ? 262_144 : 0})
      const upstream = f.upstreams[0]!
      upstream.open()
      if (direction === "binary") upstream.emit(new Uint8Array([1]))
      else if (direction === "large") upstream.emit("x".repeat(65_537))
      else if (direction === "client-buffer") upstream.emit("{}")
      else if (direction === "upstream-buffer") {upstream.bufferedAmount = 262_144; relay.message("{}")}
      else {f.setConnections([{...saved, endpoint: {...saved.endpoint, profile: "changed"}}]); await f.access.invalidate()}
      expect(receiver.closed).toEqual([direction === "save" ? 1000 : direction === "binary" || direction === "large" ? 1009 : 1013])
      expect(upstream.closed).toHaveLength(1)
      expect(receiver.sent).toHaveLength(0)
      expect(upstream.sent).toHaveLength(0)
    } finally {await f.access.dispose()}
  }
})

test("отмена во время SSH preparation освобождает поздно полученный tunnel и не читает Capsule", async () => {
  let resolve!: (value: {port: number, dispose(): Promise<void>}) => void
  let started!: () => void
  const waiting = new Promise<void>(done => {started = done})
  let disposed = 0
  let reads = 0
  const access = createCapsuleViewerAccess({connections: async () => [{...saved, ssh: {host: "machine", providerRoot: "/provider", storageRoot: "/storage"}}],
    tunnel: async input => {
      expect(input).toEqual({host: "machine", destination: {host: "127.0.0.1", port: 17777}})
      started()
      return await new Promise(done => {resolve = done})
    }, fetch: (async () => {reads++; return Response.json({ok: true, sessions: [running]})})})
  const controller = new AbortController()
  const opening = access.open("qwen", controller.signal)
  await waiting
  controller.abort()
  resolve({port: 20000, async dispose() {disposed++}})
  await expect(opening).rejects.toThrow("отменено")
  await access.dispose()
  expect(disposed).toBe(1)
  expect(reads).toBe(0)
})

test("pending TTL, failed upgrade close, settings invalidation и dispose освобождают только owned tunnel", async () => {
  for (const operation of ["expiry", "close", "save", "dispose"] as const) {
    let disposed = 0
    let connections: readonly Connection[] = [{...saved, ssh: {host: "machine", user: "admin", port: 2222, providerRoot: "/provider", storageRoot: "/storage"}}]
    const requests: string[] = []
    const access = createCapsuleViewerAccess({connections: async () => connections, ticketTtlMs: 15,
      tunnel: async input => {
        expect(input).toEqual({host: "machine", user: "admin", port: 2222, destination: {host: "127.0.0.1", port: 17777}})
        return {port: 20000, async dispose() {disposed++}}
      }, fetch: (async url => {requests.push(String(url)); return Response.json({ok: true, sessions: [running]})})})
    const opened = await access.open("qwen", signal())
    if (operation === "expiry") await Bun.sleep(30)
    else if (operation === "close") await (await access.consume(ticket(opened.socketPath), "viewer-1", signal())).close()
    else if (operation === "save") {connections = []; await access.invalidate()}
    await access.dispose()
    expect(disposed).toBe(1)
    expect(requests.every(value => value === "http://127.0.0.1:20000/api/studio/lifecycle/state")).toBeTrue()
  }
})

test("предел учитывает pending билеты; oversized HTTP state и сохранённый non-loopback отклоняются", async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 4; i++) await f.access.open("qwen", signal())
    await expect(f.access.open("qwen", signal())).rejects.toThrow("число")
  } finally {await f.access.dispose()}
  const access = createCapsuleViewerAccess({connections: async () => [saved], fetch: (async () => new Response("x".repeat(262_145)))})
  await expect(access.open("qwen", signal())).rejects.toThrow("большой")
  await access.dispose()
  const unsafe = createCapsuleViewerAccess({connections: async () => [{...saved, endpoint: {...saved.endpoint, url: "http://remote:17777"}}]})
  await expect(unsafe.open("qwen", signal())).rejects.toThrow("loopback")
  await unsafe.dispose()
})

test("отменённые SSH preparations занимают слоты до освобождения позднего tunnel", async () => {
  type Tunnel = {port: number, dispose(): Promise<void>}
  const tunnels: ReturnType<typeof Promise.withResolvers<Tunnel>>[] = []
  const firstDisposal = Promise.withResolvers<void>()
  let disposalStarted = 0
  let disposed = 0
  const access = createCapsuleViewerAccess({maximum: 2,
    connections: async () => [{...saved, ssh: {host: "machine", providerRoot: "/provider", storageRoot: "/storage"}}],
    tunnel: async () => {
      const pending = Promise.withResolvers<Tunnel>()
      tunnels.push(pending)
      return await pending.promise
    },
    fetch: async () => Response.json({ok: true, sessions: [running]}),
  })
  const first = new AbortController()
  const second = new AbortController()
  const opening = [access.open("qwen", first.signal).catch(error => error), access.open("qwen", second.signal).catch(error => error)]
  await Bun.sleep(0)
  expect(tunnels).toHaveLength(2)
  first.abort()
  second.abort()
  await Bun.sleep(0)
  for (let attempt = 0; attempt < 6; attempt++) await expect(access.open("qwen", signal())).rejects.toThrow("число")
  expect(tunnels).toHaveLength(2)
  tunnels[0]!.resolve({port: 20000, async dispose() {disposalStarted++; await firstDisposal.promise; disposed++}})
  await Bun.sleep(0)
  expect(disposalStarted).toBe(1)
  await expect(access.open("qwen", signal())).rejects.toThrow("число")
  firstDisposal.resolve()
  expect(await opening[0]).toBeInstanceOf(Error)
  expect(disposed).toBe(1)
  const third = new AbortController()
  const next = access.open("qwen", third.signal).catch(error => error)
  await Bun.sleep(0)
  expect(tunnels).toHaveLength(3)
  third.abort()
  tunnels[1]!.resolve({port: 20001, async dispose() {disposed++}})
  tunnels[2]!.resolve({port: 20002, async dispose() {disposed++}})
  await Promise.all([opening[1], next])
  await access.dispose()
  expect(disposed).toBe(3)
})

test("closing viewer удерживает слот до завершения owned tunnel dispose", async () => {
  const disposal = Promise.withResolvers<void>()
  let started = 0
  const access = createCapsuleViewerAccess({maximum: 1,
    connections: async () => [{...saved, ssh: {host: "machine", providerRoot: "/provider", storageRoot: "/storage"}}],
    tunnel: async () => {started++; return {port: 20000, async dispose() {await disposal.promise}}},
    fetch: async () => Response.json({ok: true, sessions: [running]}),
  })
  const opened = await access.open("qwen", signal())
  const relay = await access.consume(ticket(opened.socketPath), "viewer-1", signal())
  const closing = relay.close()
  await expect(access.open("qwen", signal())).rejects.toThrow("число")
  expect(started).toBe(1)
  disposal.resolve()
  await closing
  await access.open("qwen", signal())
  expect(started).toBe(2)
  await access.dispose()
})
