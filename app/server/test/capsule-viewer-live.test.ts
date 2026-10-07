import {expect, test} from "bun:test"
import createSettings from "@zavx0z/storybook-app-settings"
import {createCapsuleViewerAccess} from "../src/capsule-viewer"

/** Явный opt-in: читает готовый saved profile и signaling hello, никогда не отправляет offer или input. */
test.if(process.env.STORYBOOK_CAPSULE_VIEWER_SMOKE === "1")("saved qwen-cdp: owned SSH tunnel, exact active instance и signaling hello без изменения Chrome", async () => {
  const settings = createSettings({project: "/Users/zavx0z/projects/zavx0z"})
  const connections = (await settings.read()).connections
  const saved = connections.find(value => value.provider === "capsule" && value.endpoint.profile === "qwen-cdp")
  expect(saved?.provider).toBe("capsule")
  if (!saved || saved.provider !== "capsule" || saved.ssh?.host !== "mesh-production1") throw new Error("Smoke разрешён только для сохранённого qwen-cdp на mesh-production1")
  const access = createCapsuleViewerAccess({connections: async () => (await settings.read()).connections})
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  let close!: () => Promise<void>
  try {
    const descriptor = await access.open(saved.id, controller.signal)
    expect(descriptor.profile).toBe(saved.endpoint.profile)
    expect(descriptor.instanceId.length).toBeGreaterThan(0)
    const ticket = new URL(descriptor.socketPath, "http://localhost").searchParams.get("ticket")!
    const relay = await access.consume(ticket, `viewer-storybook-smoke-${Date.now()}`, controller.signal)
    close = relay.close
    const hello = Promise.withResolvers<void>()
    relay.attach({send(value) {
      const data: unknown = JSON.parse(value)
      if (data !== null && typeof data === "object" && "type" in data && data.type === "hello") hello.resolve()
    }, close() {}, getBufferedAmount: () => 0})
    await Promise.race([hello.promise, new Promise<never>((_, reject) => {
      const fail = () => reject(new Error("Не получен signaling hello Capsule"))
      controller.signal.addEventListener("abort", fail, {once: true})
      hello.promise.then(() => controller.signal.removeEventListener("abort", fail))
    })])
    await relay.close()
  } finally {
    clearTimeout(timeout)
    await close?.()
    await access.dispose()
  }
}, 35_000)
