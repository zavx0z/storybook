import {expect, test} from "bun:test"
import {createBrowserViewerAccess} from "../src/browser-viewer"
import type {BrowserViewerPeerAdapter} from "../src/browser-viewer-peer"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"

type Connection = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>["connections"][number]
const saved = {id: "browser", label: "Browser", enabled: true, provider: "capsule" as const,
  endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "qwen" as const},
  peer: {peerId: "codespace-peer", executorId: "capsule-executor"}}
const signal = () => new AbortController().signal
const ticket = (path: string) => new URL(path, "http://localhost").searchParams.get("ticket")!

/** Виртуальный socket использует тот же bounded signaling relay, что и native transport. */
class Socket extends EventTarget implements ReturnType<BrowserViewerPeerAdapter["socket"]> {
  readyState = 0
  bufferedAmount = 0
  sent: string[] = []
  closed = false
  send(value: string) {this.sent.push(value)}
  close() {this.closed = true
    this.readyState = 3}
  open() {this.readyState = 1
    this.dispatchEvent(new Event("open"))}
  emit(value: string) {this.dispatchEvent(new MessageEvent("message", {data: value}))}
}

/** Peer fixture запрещает случайное обращение к локальному HTTP, SSH и URL-based WebSocket. */
function fixture() {
  let connections: readonly Connection[] = [saved]
  let description: Awaited<ReturnType<BrowserViewerPeerAdapter["describe"]>> = {instanceId: "active-instance", profile: "work", controlEnabled: true}
  const described: Parameters<BrowserViewerPeerAdapter["describe"]>[0][] = []
  const opened: Parameters<BrowserViewerPeerAdapter["socket"]>[0][] = []
  const sockets: Socket[] = []
  const access = createBrowserViewerAccess({connections: async () => connections,
    async fetch() {throw new Error("must not fetch local endpoint")},
    async tunnel() {throw new Error("must not open SSH")},
    socket() {throw new Error("must not open URL socket")},
    peerPreview: {
      async describe(input) {described.push(input)
        return description},
      socket(input) {opened.push(input)
        const socket = new Socket()
        sockets.push(socket)
        return socket},
    },
  })
  return {access, described, opened, sockets, setConnections(value: readonly Connection[]) {connections = value},
    setDescription(value: Awaited<ReturnType<BrowserViewerPeerAdapter["describe"]>>) {description = value}}
}

test("peer viewer revalidates remote profile and uses a one-shot same-origin ticket without local transports", async () => {
  const f = fixture()
  try {
    const descriptor = await f.access.open(saved.id, signal())
    expect(Object.keys(descriptor).sort()).toEqual(["controlEnabled", "instanceId", "profile", "socketPath"])
    expect(JSON.stringify(descriptor)).not.toContain(saved.peer.peerId)
    expect(JSON.stringify(descriptor)).not.toContain(saved.peer.executorId)
    expect(JSON.stringify(descriptor)).not.toContain(saved.endpoint.url)
    const relay = await f.access.consume(ticket(descriptor.socketPath), "viewer-1", signal())
    expect(f.described).toHaveLength(2)
    expect(f.described[0]).toMatchObject(saved.peer)
    await expect(f.access.consume(ticket(descriptor.socketPath), "viewer-2", signal())).rejects.toThrow("использован")
    const received: string[] = []
    relay.attach({send(value) {received.push(value)}, close() {}, getBufferedAmount: () => 0})
    expect(f.opened).toEqual([{...saved.peer, instanceId: "active-instance", viewerPeerId: "viewer-1"}])
    const raw = ' {"type":"offer","description":{"sdp":"unchanged"}} '
    relay.message(raw)
    f.sockets[0]!.open()
    expect(f.sockets[0]!.sent).toEqual([raw])
    f.sockets[0]!.emit(raw)
    expect(received).toEqual([raw])
    await relay.close()
    expect(f.sockets[0]!.closed).toBeTrue()
  } finally {await f.access.dispose()}
})

test.each(["instance", "profile", "control"] as const)("peer viewer rejects changed remote %s before signaling", async change => {
  const f = fixture()
  try {
    const descriptor = await f.access.open(saved.id, signal())
    f.setDescription({instanceId: change === "instance" ? "replacement" : "active-instance",
      profile: change === "profile" ? "other" : "work", controlEnabled: change !== "control"})
    await expect(f.access.consume(ticket(descriptor.socketPath), "viewer", signal())).rejects.toThrow()
    expect(f.opened).toHaveLength(0)
  } finally {await f.access.dispose()}
})

test("changing peer or executor invalidates the original ticket and closes the active preview", async () => {
  const f = fixture()
  try {
    const descriptor = await f.access.open(saved.id, signal())
    f.setConnections([{...saved, peer: {...saved.peer, executorId: "other"}}])
    await expect(f.access.consume(ticket(descriptor.socketPath), "viewer", signal())).rejects.toThrow("изменилось")
    f.setConnections([saved])
    const next = await f.access.open(saved.id, signal())
    const relay = await f.access.consume(ticket(next.socketPath), "viewer", signal())
    relay.attach({send() {}, close() {}, getBufferedAmount: () => 0})
    f.setConnections([{...saved, peer: {...saved.peer, peerId: "other-peer"}}])
    await f.access.invalidate()
    expect(f.sockets[0]!.closed).toBeTrue()
  } finally {await f.access.dispose()}
})

test("missing preview capability and ambiguous SSH are clear failures without fallback", async () => {
  let requests = 0
  const access = createBrowserViewerAccess({connections: async () => [saved], async fetch() {requests++
    throw new Error("must not fetch")}, async tunnel() {requests++
    throw new Error("must not tunnel")}})
  try {
    await expect(access.open(saved.id, signal())).rejects.toThrow("Peer preview не настроен")
    expect(requests).toBe(0)
  } finally {await access.dispose()}
  const ambiguous = createBrowserViewerAccess({connections: async () => [{...saved, ssh: {host: "remote", providerRoot: "/provider", storageRoot: "/data"}}]})
  try {await expect(ambiguous.open(saved.id, signal())).rejects.toThrow("Peer и SSH")}
  finally {await ambiguous.dispose()}
})

test("dispose during peer describe aborts its scope and never opens a virtual signaling socket", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<BrowserViewerPeerAdapter["describe"]>>>()
  const started = Promise.withResolvers<AbortSignal>()
  let sockets = 0
  const access = createBrowserViewerAccess({connections: async () => [saved], peerPreview: {
    describe(input) {started.resolve(input.signal)
      return pending.promise},
    socket() {sockets++
      return new Socket()},
  }})
  const opening = access.open(saved.id, signal()).then(() => false, () => true)
  const scope = await started.promise
  const closing = access.dispose()
  expect(scope.aborted).toBeTrue()
  pending.resolve({instanceId: "active-instance", profile: "work", controlEnabled: true})
  expect(await opening).toBeTrue()
  await closing
  expect(sockets).toBe(0)
})

test("Chrome Studio peer control capability comes from the described executor", async () => {
  const f = fixture()
  try {
    f.setConnections([{...saved, provider: "chrome-studio"}])
    f.setDescription({instanceId: "studio-instance", profile: "work", controlEnabled: false})
    const descriptor = await f.access.open(saved.id, signal())
    expect(descriptor.controlEnabled).toBeFalse()
  } finally {await f.access.dispose()}
})
