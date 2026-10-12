import {expect, test} from "bun:test"
import {chmod, mkdtemp, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import type {PeerNetwork, PeerNetworkOptions, PeerSnapshot, SignalTransport} from "@metafor/tech-peer"
import type {PeerClient, PeerOpenInput} from "@zavx0z/provider-tech-peer/types"
import {createPeerExecution, loadPeerConfiguration, type PeerExecutionDependencies} from "../src/peer"
import type {BrowserViewerPeerAdapter} from "../src/browser-viewer-peer"

/** Private fixture использует только свой временный каталог и подмены публичных transport factories. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "storybook-peer-runtime-"))
  const tokenFile = join(root, "token")
  const token = "private-test-token-never-public-12345"
  await writeFile(tokenFile, token, {mode: 0o600})
  const config = {id: "storybook-peer", signalingUrl: "ws://127.0.0.1:19999/peer", tokenFile}
  const statePath = join(root, "server.json")
  const calls = {signaling: 0, network: 0, client: 0, bootstrapClosed: 0, networkClosed: 0, clientClosed: 0, connected: [] as string[], opened: [] as PeerOpenInput[]}
  let networkOptions: PeerNetworkOptions | undefined
  const current: PeerSnapshot = {id: config.id, peers: ["remote"], bootstrap: true, links: []}
  const bootstrap: SignalTransport = {open: true, send() {}, subscribe: () => () => {}, peers: () => ["remote"], subscribePeers: () => () => {}, close() {calls.bootstrapClosed++}}
  const network: PeerNetwork = {id: config.id,
    async connect(peerId) {calls.connected.push(peerId)
      current.links.push({peerId, generation: "generation", state: "open"})},
    async send() {}, onData: () => () => {}, subscribe: () => () => {}, snapshot: () => structuredClone(current),
    async disconnect() {}, closeBootstrap() {bootstrap.close()}, async close() {calls.networkClosed++
      bootstrap.close()},
  }
  const client: PeerClient = {
    async open(input) {
      calls.opened.push(input)
      return {stream: {readable: new ReadableStream(), writable: new WritableStream()}, closed: new Promise<void>(() => {}), async dispose() {}}
    },
    async close() {calls.clientClosed++},
  }
  const dependencies: PeerExecutionDependencies = {
    async signaling(options) {calls.signaling++
      expect(options.token).toBe(token)
      return bootstrap},
    rtc: () => () => {throw new Error("Fake network does not create actual RTC")},
    network(options) {calls.network++
      networkOptions = options
      return network},
    client() {calls.client++
      return client},
  }
  return {root, token, tokenFile, config, statePath, calls, network, client, bootstrap, dependencies, networkOptions: () => networkOptions,
    async dispose() {await rm(root, {recursive: true, force: true})}}
}

/** Локальная factory identity не передаёт пути, credentials или команды удалённому executor. */
function request(signal = new AbortController().signal) {
  return {connectionId: "stable", peerId: "remote", executorId: "configured", assignmentId: "worker-1", previousSessionId: "native-old", signal}
}

test("absent private configuration keeps peer feature off without factories or network", async () => {
  const f = await fixture()
  try {
    expect(await loadPeerConfiguration({statePath: f.statePath})).toBeUndefined()
    const runtime = createPeerExecution(undefined, f.dependencies)
    expect(runtime.openPeer).toBeUndefined()
    expect(runtime.snapshot()).toBeUndefined()
    await runtime.close()
    expect(f.calls.signaling).toBe(0)
    expect(f.calls.network).toBe(0)
  } finally {await f.dispose()}
})

test("private peer.json and explicit config use same validation; false bypasses machine file", async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.root, "peer.json"), JSON.stringify(f.config), {mode: 0o600})
    expect(await loadPeerConfiguration({statePath: f.statePath})).toEqual(f.config)
    expect(await loadPeerConfiguration({statePath: f.statePath, peer: f.config})).toEqual(f.config)
    await chmod(join(f.root, "peer.json"), 0o644)
    await expect(loadPeerConfiguration({statePath: f.statePath})).rejects.toThrow("приватную peer configuration")
    expect(await loadPeerConfiguration({statePath: f.statePath, peer: false})).toBeUndefined()
  } finally {await f.dispose()}
})

test("private configuration rejects credentials in URL and unknown launch parameters", async () => {
  const f = await fixture()
  try {
    for (const signalingUrl of ["http://localhost/peer", "ws://user:secret@localhost/peer", "ws://localhost/peer?token=secret", "ws://localhost/peer#secret"]) {
      const error = await loadPeerConfiguration({statePath: f.statePath, peer: {...f.config, signalingUrl}}).catch(error => error)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).not.toContain("secret")
    }
    await expect(loadPeerConfiguration({statePath: f.statePath, peer: {...f.config, command: "shell"} as typeof f.config})).rejects.toThrow("configuration")
    await expect(loadPeerConfiguration({statePath: f.statePath, peer: {...f.config, relay: "true"} as unknown as typeof f.config})).rejects.toThrow("relay mode")
  } finally {await f.dispose()}
})

test("application relay is explicit and preserves the public transport route in snapshots", async () => {
  const f = await fixture()
  let requestedRelay: boolean | undefined
  let routed = 0
  const runtime = createPeerExecution({...f.config, relay: true}, {...f.dependencies,
    async signaling(options) {
      requestedRelay = options.relay
      return f.bootstrap
    },
    routedNetwork(options) {
      routed++
      expect(options.bootstrap as SignalTransport).toBe(f.bootstrap)
      return {...f.network, snapshot() {
        return {id: f.config.id, bootstrap: true, peers: ["remote"], links: [{peerId: "remote", generation: "relay-generation", state: "open", transport: "relay"}]}
      }}
    },
  })
  try {
    await runtime.openPeer!(request())
    expect(requestedRelay).toBeTrue()
    expect(routed).toBe(1)
    expect(f.calls.network).toBe(0)
    expect(runtime.snapshot()?.links[0]?.transport).toBe("relay")
    expect(f.calls.opened).toHaveLength(1)
  } finally {
    await runtime.close()
    await f.dispose()
  }
})

test("default direct mode does not opt in to relay or instantiate its network", async () => {
  const f = await fixture()
  const runtime = createPeerExecution({...f.config, relay: false}, {...f.dependencies,
    async signaling(options) {
      expect(options.relay).toBeUndefined()
      return f.bootstrap
    },
    routedNetwork() {throw new Error("Relay was not authorized")},
  })
  try {
    await runtime.openPeer!(request())
    expect(f.calls.network).toBe(1)
  } finally {
    await runtime.close()
    await f.dispose()
  }
})

test("runtime connects lazily and retains executor, assignment and native session identity", async () => {
  const f = await fixture()
  const runtime = createPeerExecution(f.config, f.dependencies)
  try {
    expect(f.calls.signaling).toBe(0)
    expect(runtime.snapshot()).toBeUndefined()
    const input = request()
    await runtime.openPeer!(input)
    await runtime.openPeer!({...input, previousSessionId: "native-second"})
    expect(f.calls.signaling).toBe(1)
    expect(f.calls.connected).toEqual([input.peerId])
    expect(f.calls.opened[0]).toEqual({peerId: input.peerId, executorId: input.executorId, assignmentId: input.assignmentId, previousSessionId: input.previousSessionId, signal: input.signal})
    expect(f.calls.opened[1]?.previousSessionId).toBe("native-second")
    expect(f.calls.opened[0]).not.toHaveProperty("connectionId")
    expect(f.networkOptions()?.iceServers).toBeUndefined()
    expect(JSON.stringify(runtime.snapshot())).not.toContain(f.token)
    expect(JSON.stringify(runtime.snapshot())).not.toContain(f.tokenFile)
  } finally {await runtime.close()
    await f.dispose()}
  expect(f.calls.clientClosed).toBe(1)
  expect(f.calls.networkClosed).toBe(1)
  expect(runtime.close()).toBe(runtime.close())
  await expect(runtime.openPeer!(request())).rejects.toThrow("закрыт")
})

test("token remains server-only, private, regular and lazily read", async () => {
  const f = await fixture()
  try {
    await chmod(f.tokenFile, 0o644)
    const first = createPeerExecution(f.config, f.dependencies)
    await expect(first.openPeer!(request())).rejects.toThrow("приватный peer token")
    await first.close()
    expect(f.calls.signaling).toBe(0)
    await chmod(f.tokenFile, 0o600)
    const link = join(f.root, "token-link")
    await symlink(f.tokenFile, link)
    const second = createPeerExecution({...f.config, tokenFile: link}, f.dependencies)
    await expect(second.openPeer!(request())).rejects.toThrow("приватный peer token")
    await second.close()
    expect(f.calls.signaling).toBe(0)
  } finally {await f.dispose()}
})

test("peer failure is returned once without SSH fallback or automatic executor retry", async () => {
  const f = await fixture()
  let attempts = 0
  const error = new Error("remote peer unavailable")
  const runtime = createPeerExecution(f.config, {...f.dependencies, network: options => ({...f.dependencies.network!(options), async connect() {attempts++
    throw error}})})
  try {
    expect(await runtime.openPeer!(request()).catch(reason => reason)).toBe(error)
    expect(attempts).toBe(1)
    expect(f.calls.opened).toHaveLength(0)
  } finally {await runtime.close()
    await f.dispose()}
})

test("parallel sessions share connect; cancellation does not cancel their common network", async () => {
  const f = await fixture()
  const connecting = Promise.withResolvers<void>()
  const began = Promise.withResolvers<void>()
  const runtime = createPeerExecution(f.config, {...f.dependencies, network: options => ({...f.dependencies.network!(options), async connect(peer) {
    f.calls.connected.push(peer)
    began.resolve()
    await connecting.promise
  }})})
  const controller = new AbortController()
  try {
    const cancelled = runtime.openPeer!(request(controller.signal)).then(() => false, () => true)
    const second = runtime.openPeer!(request())
    await began.promise
    controller.abort()
    expect(await cancelled).toBeTrue()
    connecting.resolve()
    await second
    expect(f.calls.connected).toEqual(["remote"])
    expect(f.calls.opened).toHaveLength(1)
  } finally {await runtime.close()
    await f.dispose()}
})

test("close during bootstrap admission releases late bootstrap without creating network", async () => {
  const f = await fixture()
  const began = Promise.withResolvers<void>()
  const admitted = Promise.withResolvers<SignalTransport>()
  const runtime = createPeerExecution(f.config, {...f.dependencies, signaling: () => {began.resolve()
    return admitted.promise}})
  try {
    const opening = runtime.openPeer!(request()).then(() => false, () => true)
    await began.promise
    const closing = runtime.close()
    admitted.resolve(f.bootstrap)
    expect(await opening).toBeTrue()
    await closing
    expect(f.calls.bootstrapClosed).toBe(1)
    expect(f.calls.network).toBe(0)
  } finally {await runtime.close()
    await f.dispose()}
})

test("configured ICE credentials go to public transport and never snapshot", async () => {
  const f = await fixture()
  const runtime = createPeerExecution({...f.config, iceServers: [{urls: ["turn:127.0.0.1:3478"], username: "private-user", credential: "private-turn-secret"}]}, f.dependencies)
  try {
    await runtime.openPeer!(request())
    expect(f.networkOptions()?.iceServers?.[0]?.credential).toBe("private-turn-secret")
    expect(JSON.stringify(runtime.snapshot())).not.toContain("private-turn-secret")
    expect(JSON.stringify(runtime.snapshot())).not.toContain("private-user")
  } finally {await runtime.close()
    await f.dispose()}
})

test("already aborted opening never reads token or starts bootstrap", async () => {
  const f = await fixture()
  const runtime = createPeerExecution({...f.config, tokenFile: join(f.root, "absent-token")}, f.dependencies)
  try {
    const controller = new AbortController()
    controller.abort(new Error("already cancelled"))
    await expect(runtime.openPeer!(request(controller.signal))).rejects.toThrow("already cancelled")
    expect(f.calls.signaling).toBe(0)
    expect(f.calls.network).toBe(0)
  } finally {await runtime.close()
    await f.dispose()}
})

test("browser describe and socket share the existing peer network and release their public client", async () => {
  const f = await fixture()
  const described: Parameters<BrowserViewerPeerAdapter["describe"]>[0][] = []
  const sockets: Parameters<BrowserViewerPeerAdapter["socket"]>[0][] = []
  let created = 0
  let released = 0
  const runtime = createPeerExecution(f.config, {...f.dependencies, browserClient(network) {
    expect(network).toBe(f.network)
    created++
    return {
      async describe(input) {described.push(input)
        return {instanceId: "instance-1", profile: "work", controlEnabled: true}},
      socket(input) {sockets.push(input)
        return {readyState: 0, bufferedAmount: 0, send() {}, close() {}, addEventListener() {}}},
      async close() {released++},
    }
  }})
  try {
    await expect(Promise.resolve().then(() => runtime.createBrowserSocket!({peerId: "remote", executorId: "configured", instanceId: "instance-1", viewerPeerId: "viewer"}))).rejects.toThrow("предварительную проверку")
    await runtime.openPeer!(request())
    const input = {peerId: "remote", executorId: "configured", signal: new AbortController().signal}
    expect(await runtime.describeBrowser!(input)).toEqual({instanceId: "instance-1", profile: "work", controlEnabled: true})
    expect(described).toEqual([input])
    runtime.createBrowserSocket!({peerId: "remote", executorId: "configured", instanceId: "instance-1", viewerPeerId: "viewer"})
    expect(sockets).toEqual([{peerId: "remote", executorId: "configured", instanceId: "instance-1", viewerPeerId: "viewer"}])
    expect(f.calls.signaling).toBe(1)
    expect(f.calls.connected).toEqual(["remote"])
    expect(created).toBe(1)
  } finally {
    await runtime.close()
    await f.dispose()
  }
  expect(released).toBe(1)
  expect(f.calls.networkClosed).toBe(1)
})

test("preview-only request does not open an ACP executor or native model session", async () => {
  const f = await fixture()
  const runtime = createPeerExecution(f.config, {...f.dependencies, browserClient: () => ({
    async describe() {return {instanceId: "instance", profile: "work", controlEnabled: false}},
    socket() {return {readyState: 0, bufferedAmount: 0, send() {}, close() {}, addEventListener() {}}},
    async close() {},
  })})
  try {
    await runtime.describeBrowser!({peerId: "remote", executorId: "configured", signal: new AbortController().signal})
    expect(f.calls.opened).toHaveLength(0)
    expect(f.calls.connected).toEqual(["remote"])
  } finally {
    await runtime.close()
    await f.dispose()
  }
})
