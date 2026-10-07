import {expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createWeb from "@zavx0z/storybook-app-web"
import startExternalStorybookServer from "../index"
import {createProjectFixture} from "./project.fixture"
import {seedPublishedSharedAssets} from "./shared-assets.fixture"

test("HTTP viewer требует registry grant, Origin и сохранённый id; WS ticket одноразовый, signaling не попадает в event bus", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-capsule-viewer-"))
  const stateRoot = mkdtempSync(join(tmpdir(), "storybook-capsule-viewer-state-"))
  const artifactRoot = join(stateRoot, "artifacts")
  seedPublishedSharedAssets(artifactRoot)
  let upstreamClosed = 0
  const observed: string[] = []
  let running = true
  const capsule = Bun.serve({hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      observed.push(url.pathname + url.search)
      if (url.pathname === "/api/studio/lifecycle/state") return Response.json({ok: true,
        sessions: [{instanceId: "already-running", profileName: "work", active: running, containerState: running ? "running" : "stopped"}]})
      if (url.pathname === "/rtc/signaling" && server.upgrade(request)) return
      return new Response(null, {status: 404})
    }, websocket: {open(socket) {socket.send(' {"type":"hello","peers":[]} ')}, message(socket, value) {socket.send(value)}, close() {upstreamClosed++}},
  })
  const server = await startExternalStorybookServer({createWeb, project: createProjectFixture(root, []), artifactRoot, statePath: join(stateRoot, "server.json")})
  const sockets: WebSocket[] = []
  try {
    const registry = await fetch(new URL("/api/browser/registry-session", server.origin), {
      method: "POST", headers: {Origin: server.origin, "content-type": "application/json"}, body: "{}"})
    const {readerToken} = await registry.json()
    const headers = {Origin: server.origin, "content-type": "application/json", "x-storybook-session": readerToken}
    const command = (operation: string, value: object, authorized = headers) => fetch(new URL(`/api/browser/chat/${operation}`, server.origin), {
      method: "POST", headers: authorized, body: JSON.stringify(value)})
    const settings = await (await command("execution-settings", {})).json()
    const savedResponse = await command("execution-settings-save", {settings: {...settings,
      connections: [{id: "qwen", label: "Qwen", enabled: true, provider: "capsule", endpoint: {url: capsule.url.origin, profile: "work", service: "qwen"}}],
      general: {connectionId: "qwen"}}})
    expect(await savedResponse.text()).not.toContain("error")
    expect(savedResponse.ok).toBeTrue()
    expect((await command("capsule-viewer-open", {connectionId: "qwen"}, {...headers, "x-storybook-session": ""})).status).toBe(401)
    expect((await command("capsule-viewer-open", {connectionId: "qwen"}, {...headers, Origin: "http://elsewhere"})).status).toBe(403)
    expect((await command("capsule-viewer-open", {connectionId: "qwen", url: "http://untrusted"})).ok).toBeFalse()
    expect(observed).toHaveLength(0)
    const descriptor = await (await command("capsule-viewer-open", {connectionId: "qwen"})).json()
    expect(descriptor).toMatchObject({instanceId: "already-running", profile: "work"})
    const endpoint = new URL(descriptor.socketPath, server.origin)
    endpoint.protocol = "ws:"
    endpoint.searchParams.set("peer", "viewer-test")
    const socket = new WebSocket(endpoint, {headers: {Origin: server.origin}} as never)
    sockets.push(socket)
    const messages: string[] = []
    socket.addEventListener("message", event => messages.push(String(event.data)))
    await waitFor(() => socket.readyState === WebSocket.OPEN && messages.length === 1)
    expect(messages).toEqual([' {"type":"hello","peers":[]} '])
    const offer = ' {"type":"offer", "description":{"sdp":"unchanged"}} '
    socket.send(offer)
    await waitFor(() => messages.length === 2)
    expect(messages[1]).toBe(offer)
    expect(observed).toEqual(["/api/studio/lifecycle/state", "/api/studio/lifecycle/state",
      "/rtc/signaling?profile=already-running&role=viewer&peer=viewer-test"])
    const reused = new WebSocket(endpoint, {headers: {Origin: server.origin}} as never)
    sockets.push(reused)
    await waitFor(() => reused.readyState === WebSocket.CLOSED)
    socket.close()
    await waitFor(() => upstreamClosed === 1)
    running = false
    expect((await command("capsule-viewer-open", {connectionId: "qwen"})).ok).toBeFalse()
    expect(observed.every(value => value.startsWith("/api/studio/lifecycle/state") || value.startsWith("/rtc/signaling?"))).toBeTrue()
  } finally {
    for (const socket of sockets) socket.close()
    await server.stop()
    capsule.stop(true)
    rmSync(root, {recursive: true, force: true})
    rmSync(stateRoot, {recursive: true, force: true})
  }
}, 15000)

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 3000
  while (!condition() && Date.now() < deadline) await Bun.sleep(5)
  if (!condition()) throw new Error("Не пришло ожидаемое событие WebSocket")
}
