import {expect, test} from "bun:test"
import {InputEvent, type HTMLButtonElement, type HTMLInputElement} from "@zavx0z/immersive"
import {createHeadless} from "@zavx0z/immersive/headless"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"
import {SettingsContent} from "../src/content"

type Settings = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>

test("отдельная SSH-карта Codex сохраняет удалённые поля и не заменяет локальное подключение", async () => {
  const headless = createHeadless({width: 700, height: 700})
  const initial: Settings = {schemaVersion: 1, revision: 0,
    connections: [{id: "codex", label: "Codex", provider: "codex", enabled: true}], general: {connectionId: "codex"}, types: {}}
  let saved: Settings | undefined
  const fetcher = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("registry-session")) return Response.json({readerToken: "fixture"})
    if (url.endsWith("execution-settings-save")) {
      saved = JSON.parse(String(init?.body)).settings as Settings
      return Response.json({...saved, revision: saved.revision + 1})
    }
    return Response.json(initial)
  }, {preconnect() {}})
  try {
    const element = await headless.render(<SettingsContent open={true} section="connections" fetcher={fetcher} />)
    await Bun.sleep(0)
    await headless.capture(element)
    const add = () => element.querySelector('button[aria-label="Добавить Codex"]') as HTMLButtonElement
    expect(add()).not.toBeNull()
    add().click()
    await headless.capture(element)
    const card = element.querySelector('[data-provider-connection="codex-codespace"]')!
    expect(card).not.toBeNull()
    const remote = card.querySelector('[aria-label="Удалённое исполнение Codex"]')!
    const inputs = remote.querySelectorAll("input")
    expect(inputs).toHaveLength(5)
    for (const [index, value] of ["codespace-host", "codespace", "2222", "/workspaces/provider", "/workspaces/state"].entries()) {
      const input = inputs[index] as HTMLInputElement
      input.value = value
      input.dispatchEvent(new InputEvent("input", {bubbles: true}))
      await headless.capture(element)
    }
    expect(card.querySelector("video")).toBeNull()
    const save = [...element.querySelectorAll("button")].find(button => button.textContent === "Сохранить") as HTMLButtonElement
    save.click()
    await Bun.sleep(0)
    await headless.capture(element)
    expect(saved?.connections).toEqual([initial.connections[0]!, {
      id: "codex-codespace", provider: "codex", label: "Codex · SSH", enabled: true,
      ssh: {host: "codespace-host", user: "codespace", port: 2222, providerRoot: "/workspaces/provider", storageRoot: "/workspaces/state"},
    }])
    expect(saved?.general).toEqual({connectionId: "codex"})
    add().click()
    await headless.capture(element)
    expect(element.querySelector('[data-provider-connection="codex-codespace-2"]')).not.toBeNull()
  } finally {await headless.dispose()}
}, 15000)
