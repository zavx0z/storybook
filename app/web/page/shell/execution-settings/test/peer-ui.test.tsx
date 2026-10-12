import {expect, test} from "bun:test"
import {InputEvent, type HTMLButtonElement, type HTMLInputElement} from "@zavx0z/immersive"
import {createHeadless} from "@zavx0z/immersive/headless"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"
import {SettingsContent} from "../src/content"
import {connectionPeer, connectionPeerError} from "../src/state"

type Settings = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
type Connection = Settings["connections"][number]

const ssh = {host: "old-host", user: "runner", port: 2222, providerRoot: "/srv/provider", storageRoot: "/srv/state"}
const connections: readonly Connection[] = [
  {id: "codex-existing", provider: "codex", label: "Codex remote", enabled: true, ssh},
  {id: "ollama-existing", provider: "ollama", label: "Ollama remote", enabled: true, endpoint: {url: "http://127.0.0.1:11434", ssh: {host: "old-host", user: "runner", port: 2222}}},
  {id: "capsule-existing", provider: "capsule", label: "Capsule remote", enabled: true, endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "qwen"}, ssh: {...ssh, dockerContext: "remote"}},
  {id: "chrome-existing", provider: "chrome-studio", label: "Chrome remote", enabled: true, endpoint: {url: "http://127.0.0.1:17778", profile: "work", service: "deepseek"}, ssh},
]

for (const connection of connections) test(`${connection.provider}: peer редактирует существующее подключение, скрывает SSH и восстанавливает черновик`, async () => {
  const headless = createHeadless({width: 800, height: 800})
  const initial: Settings = {schemaVersion: 1, revision: 0, connections: [connection], general: {connectionId: connection.id}, types: {}}
  const saved: Settings[] = []
  const fetcher = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("registry-session")) return Response.json({readerToken: "fixture"})
    if (url.endsWith("execution-settings-save")) {
      const value = JSON.parse(String(init?.body)).settings as Settings
      saved.push(value)
      return Response.json({...value, revision: value.revision + 1})
    }
    return Response.json(initial)
  }, {preconnect() {}})
  try {
    const element = await headless.render(<SettingsContent open={true} section="connections" fetcher={fetcher} />)
    await Bun.sleep(0)
    await headless.capture(element)
    const button = (text: string) => [...element.querySelectorAll("button")].find(button => button.textContent === text) as HTMLButtonElement
    button({codex: "Codex", ollama: "Ollama", capsule: "Capsule", "chrome-studio": "Chrome Studio"}[connection.provider]).click()
    await headless.capture(element)
    button(connection.label).click()
    await headless.capture(element)
    const card = element.querySelector(`[data-provider-connection="${connection.id}"]`)!
    const toggle = () => card.querySelector('[title="Использовать Пир"] input') as HTMLInputElement
    toggle().click()
    await headless.capture(element)
    expect(card.querySelector('[title="Использовать SSH"]')).toBeNull()
    expect(card.querySelector('section[aria-label="Исполнение через пира"]')).not.toBeNull()
    button("Сохранить").click()
    await headless.capture(element)
    expect(saved).toHaveLength(0)
    expect(element.textContent).toContain("укажите участника")
    const inputs = card.querySelector('section[aria-label="Исполнение через пира"]')!.querySelectorAll("input")
    for (const [index, value] of ["ai-peer", "acp-main"].entries()) {
      const input = inputs[index] as HTMLInputElement
      input.value = value
      input.dispatchEvent(new InputEvent("input", {bubbles: true}))
      await headless.capture(element)
    }
    button("Сохранить").click()
    await Bun.sleep(0)
    await headless.capture(element)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.connections).toEqual([connectionPeer(connection, {peerId: "ai-peer", executorId: "acp-main"})])
    expect(saved[0]!.general).toEqual(initial.general)
    expect(saved[0]!.connections[0]!.id).toBe(connection.id)
    expect(element.textContent).toContain("ai-peer / acp-main")
    toggle().click()
    await headless.capture(element)
    expect(card.querySelector('section[aria-label="Исполнение через пира"]')).toBeNull()
    expect(card.querySelector('[title="Использовать SSH"]')).not.toBeNull()
    button("Сохранить").click()
    await Bun.sleep(0)
    await headless.capture(element)
    expect(saved[1]!.connections).toEqual([connection])
    expect(saved[1]!.connections).toHaveLength(1)
  } finally { await headless.dispose() }
}, 15_000)

test("peer payload сохраняет endpoint и принимает только IDs публичного формата", () => {
  for (const connection of connections) {
    const peer = connectionPeer(connection, {peerId: "peer_1:west", executorId: "executor.main-2"})
    expect(connectionPeerError([peer])).toBe("")
    expect(peer.id).toBe(connection.id)
    expect(connectionPeer(peer, undefined, connection)).toEqual(connection)
    expect(connectionPeerError([connectionPeer(connection, {peerId: "valid", executorId: ""})])).toContain("исполнителя")
    expect(connectionPeerError([connectionPeer(connection, {peerId: "invalid host", executorId: "valid"})])).toContain("ASCII")
    expect(connectionPeerError([connectionPeer(connection, {peerId: "x".repeat(257), executorId: "valid"})])).toContain("ASCII")
    expect(connectionPeerError([{...connection, peer: {peerId: "valid", executorId: "valid"}}])).toContain("одновременно")
  }
})
