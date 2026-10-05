import {expect, test} from "bun:test"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createWeb from "@zavx0z/storybook-app-web"
import startExternalStorybookServer from "../index"
import {createProjectFixture} from "./project.fixture"
import {seedPublishedSharedAssets} from "./shared-assets.fixture"

test("восемь живых WebSocket бесед получают снимки, HTTP остаётся конечным, чужой адрес отклоняется", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-chat-websocket-"))
  const artifactRoot = join(root, "artifacts")
  seedPublishedSharedAssets(artifactRoot)
  const server = await startExternalStorybookServer({
    createWeb, project: createProjectFixture(root, []), artifactRoot, statePath: join(root, "state/server.json"),
  })
  const sockets: WebSocket[] = []
  try {
    const subscribe = async () => {
      const grant = await fetch(new URL("/api/browser/registry-session", server.origin), {
        method: "POST", headers: {Origin: server.origin, "content-type": "application/json"}, body: "{}",
      })
      expect(grant.ok).toBeTrue()
      const {readerToken} = await grant.json()
      const url = new URL(`/api/events?session=${readerToken}`, server.origin)
      url.protocol = "ws:"
      const socket = new WebSocket(url, {headers: {Origin: server.origin}} as never)
      sockets.push(socket)
      const messages: any[] = []
      socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))))
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), {once: true})
        socket.addEventListener("error", () => reject(new Error("Socket failed")), {once: true})
      })
      socket.send(JSON.stringify({type: "subscribe", topic: "chat:/"}))
      await until(() => messages.some(message => message.type === "chat.snapshot"))
      expect(messages[0]).toMatchObject({type: "chat.snapshot", address: "/", snapshot: {address: "/", status: "idle", messages: []}})
      return {socket, messages, readerToken}
    }
    const tabs = await Promise.all(Array.from({length: 8}, subscribe))
    const token = tabs[0]!.readerToken
    const response = await fetch(new URL("/api/browser/chat/session", server.origin), {
      method: "POST", headers: {Origin: server.origin, "content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify({address: "/"}),
    })
    expect(response.ok).toBeTrue()
    expect(await response.json()).toMatchObject({address: "/", status: "idle"})
    const tab = tabs[0]!
    tab.socket.send(JSON.stringify({type: "subscribe", topic: "chat:/"}))
    tab.socket.send(JSON.stringify({type: "subscribe", topic: "chat:/missing"}))
    await until(() => tab.messages.some(message => message.type === "subscription.failed"))
    expect(tab.messages.filter(message => message.type === "chat.snapshot")).toHaveLength(1)
    expect(tab.messages.find(message => message.type === "subscription.failed")?.message).toBeString()
    const createdResponse = await fetch(new URL("/api/browser/chat/create", server.origin), {
      method: "POST", headers: {Origin: server.origin, "content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify({address: "/", label: "Второй специалист"}),
    })
    expect(createdResponse.ok).toBeTrue()
    const created = await createdResponse.json()
    expect(created.executorId).not.toBe(tab.messages[0].snapshot.executorId)
    tab.socket.send(JSON.stringify({type: "subscribe", topic: "chat:/", executorId: created.executorId}))
    await until(() => tab.messages.some(message => message.type === "chat.snapshot" && message.executorId === created.executorId))
    expect(tab.messages.find(message => message.executorId === created.executorId)?.snapshot)
      .toMatchObject({address: "/", executorLabel: "Второй специалист", messages: [], status: "idle"})
    const legacy = await fetch(new URL("/api/browser/chat/events", server.origin), {headers: {"x-storybook-session": token}})
    expect(legacy.status).toBe(410)
    expect(await legacy.json()).toHaveProperty("error")
  } finally {
    for (const socket of sockets) socket.close()
    await server.stop()
    rmSync(root, {recursive: true, force: true})
  }
}, 15000)

async function until(condition: () => boolean) {
  const deadline = Date.now() + 2000
  while (!condition() && Date.now() < deadline) await Bun.sleep(5)
  if (!condition()) throw new Error("WebSocket event was not received")
}
