import {expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createWeb from "@app/web"
import startServer from "../index"
import {createProjectFixture} from "./project.fixture"
import {seedPublishedSharedAssets} from "./shared-assets.fixture"

test("HTTP и WebSocket Storybook обслуживаются во время реального обновления каталога", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-catalog-responsive-"))
  const repo = join(root, "repo")
  mkdirSync(repo)
  writeFileSync(join(repo, "package.json"), JSON.stringify({name: "@fixture/catalog-responsive", version: "0.0.0", type: "module"}))
  writeFileSync(join(repo, "index.ts"), "/** Исходный обзор. @packageDocumentation */\nexport const value = 1\n")
  const artifactRoot = join(root, "artifacts")
  seedPublishedSharedAssets(artifactRoot)
  const server = await startServer({createWeb, project: createProjectFixture(root, [repo]), artifactRoot, statePath: join(root, "state/server.json")})
  let socket: WebSocket | undefined
  try {
    const grant = await (await fetch(new URL("/api/browser/registry-session", server.origin), {
      method: "POST", headers: {Origin: server.origin, "content-type": "application/json"}, body: "{}",
    })).json()
    const url = new URL(`/api/events?session=${grant.readerToken}`, server.origin)
    url.protocol = "ws:"
    socket = new WebSocket(url, {headers: {Origin: server.origin}} as never)
    const messages: {type: string}[] = []
    socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))))
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), {once: true})
      socket!.addEventListener("error", reject, {once: true})
    })
    writeFileSync(join(repo, "index.ts"), "/** Обновлённый обзор. @packageDocumentation */\nexport const value = 2\n")
    writeFileSync(join(repo, "package.json"), JSON.stringify({name: "@fixture/catalog-responsive", label: "Обновлённый каталог", version: "0.0.0", type: "module"}))
    server.registry.markDirty(join(repo, "package.json"))
    let complete = false
    const update = fetch(new URL("/api/control/refresh", server.origin), {
      method: "POST", headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
      body: JSON.stringify({force: false}),
    }).then(async response => {
      expect(response.ok).toBeTrue()
      await response.json()
    }).finally(() => { complete = true })
    let responsiveDuringRefresh = 0
    while (!complete) {
      const refreshing = server.registry.metrics().refreshing
      const response = await fetch(new URL("/api/health", server.origin), {signal: AbortSignal.timeout(1000)})
      expect(response.status).toBe(200)
      if (refreshing && !complete) {
        responsiveDuringRefresh += 1
        socket.send(JSON.stringify({type: "subscribe", topic: "registry"}))
      }
      await Bun.sleep(5)
    }
    await update
    expect(responsiveDuringRefresh).toBeGreaterThan(0)
    expect(messages.some(message => message.type === "subscribed")).toBeTrue()
    const deliveryDeadline = Date.now() + 1000
    while (!messages.some(message => message.type === "registry.updated") && Date.now() < deliveryDeadline) await Bun.sleep(5)
    expect(messages.some(message => message.type === "registry.updated")).toBeTrue()
    expect(server.sessions.buildSchedulerSnapshot().recent).toHaveLength(0)
  } finally {
    socket?.close()
    await server.stop()
    rmSync(root, {recursive: true, force: true})
  }
}, 15000)
