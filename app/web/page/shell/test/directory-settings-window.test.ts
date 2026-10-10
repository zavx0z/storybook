import {expect, test} from "bun:test"
import {InputEvent, type HTMLInputElement} from "@zavx0z/immersive"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import ExecutionSettings from "@zavx0z/storybook-app-web-page-shell-execution-settings"
import type {createDirectorySettingsClient, DirectorySettingsDraft} from "../src/directory-settings-client"
import {createWindowHost} from "./fixture/mcp-window-host"

type Client = ReturnType<typeof createDirectorySettingsClient>

const configured = {projectsDirectory: "/projects", repositoriesDirectory: "/repos"}
async function mount(client: Client) {
  const host = createWindowHost()
  const props = {
    directories: client,
    fetcher: Object.assign(async (input: RequestInfo | URL) => Response.json(
      String(input).endsWith("registry-session") ? {readerToken: "fixture"}
        : {schemaVersion: 1, revision: 0, connections: [], general: {}, types: {}},
    ), {preconnect() {}}),
  }
  host.component.render(ExecutionSettings as unknown as CompiledTemplate<typeof props>, props)
  await host.settle()
  return host
}

function fields(host: Awaited<ReturnType<typeof mount>>) {
  return [...host.container.querySelectorAll("input")] as HTMLInputElement[]
}

async function edit(host: Awaited<ReturnType<typeof mount>>, index: number, value: string) {
  const input = fields(host)[index]!
  input.value = value
  input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: value}))
  await host.settle()
}

test("настроенная среда открывается через Tab в том же Document", async () => {
  const host = await mount({read: async () => configured, save: async () => configured})
  try {
    const window = host.container.querySelector("[data-window]")!
    expect(window.hasAttribute("hidden")).toBeTrue()
    await host.click("Настройки")
    expect(window.hasAttribute("hidden")).toBeFalse()
    expect(fields(host).map(field => field.value)).toEqual(["/projects", "/repos"])
    expect(window.ownerDocument).toBe(host.document)
    await host.click("Закрыть")
    expect(window.hasAttribute("hidden")).toBeTrue()
  } finally {host.dispose()}
})

test("любой незаданный каталог автоматически открывает окно", async () => {
  for (const value of [{...configured, projectsDirectory: null}, {...configured, repositoriesDirectory: null}]) {
    const host = await mount({read: async () => value, save: async () => configured})
    try {
      expect(host.container.querySelector("[data-window]")!.hasAttribute("hidden")).toBeFalse()
      expect(host.button("Сохранить").hasAttribute("disabled")).toBeTrue()
    } finally {host.dispose()}
  }
})

test("ошибка сохраняет черновик, повтор подтверждает нормализованные пути", async () => {
  const calls: DirectorySettingsDraft[] = []
  const host = await mount({
    read: async () => ({...configured, projectsDirectory: null}),
    save: async draft => {
      calls.push(draft)
      if (calls.length === 1) throw new Error("Каталог недоступен")
      return configured
    },
  })
  try {
    await edit(host, 0, "~/projects")
    await edit(host, 1, "~/repos")
    await host.click("Сохранить")
    expect(host.container.querySelector('[role="alert"]')?.children[1]?.textContent).toBe("Каталог недоступен")
    expect(fields(host).map(field => field.value)).toEqual(["~/projects", "~/repos"])
    await host.click("Закрыть уведомление")
    expect(host.container.querySelector('[role="alert"]')).toBeNull()
    expect(host.container.querySelector("[data-window]")!.hasAttribute("hidden")).toBeFalse()
    expect(fields(host).map(field => field.value)).toEqual(["~/projects", "~/repos"])
    await host.click("Сохранить")
    expect(calls).toEqual([
      {projectsDirectory: "~/projects", repositoriesDirectory: "~/repos"},
      {projectsDirectory: "~/projects", repositoriesDirectory: "~/repos"},
    ])
    expect(fields(host).map(field => field.value)).toEqual(["/projects", "/repos"])
    expect(host.container.querySelector('[role="alert"]')).toBeNull()
    expect(host.container.querySelector('[role="status"]')?.textContent).toBe("Каталоги сохранены.")
    expect(host.button("Сохранить").hasAttribute("disabled")).toBeTrue()
  } finally {host.dispose()}
})

test("ошибку чтения можно повторить, удаление окна отменяет запросы", async () => {
  let reads = 0
  let signal: AbortSignal | undefined
  const host = await mount({read: async current => {
    signal = current
    if (++reads === 1) throw new Error("Настройки недоступны")
    return configured
  }, save: async () => configured})
  try {
    expect(host.container.querySelector("[data-window]")!.hasAttribute("hidden")).toBeFalse()
    expect(host.container.querySelector('[role="alert"]')?.children[1]?.textContent).toBe("Настройки недоступны")
    const window = host.container.querySelector('[data-window]')!
    const notification = window.querySelector('[data-window-message] [role="alert"]')!
    expect(window.querySelector('[data-window-body]')!.contains(notification)).toBeFalse()
    expect(notification.getAttribute("data-tone")).toBe("error")
    const frame = host.bounds(window)
    const message = host.bounds(notification)
    expect(message.x >= frame.x && message.x < frame.x + 12).toBeTrue()
    expect(message.y + message.height <= frame.y + frame.height).toBeTrue()
    expect(message.y + message.height > frame.y + frame.height - 12).toBeTrue()
    await host.click("Повторить загрузку")
    expect(fields(host).map(field => field.value)).toEqual(["/projects", "/repos"])
    expect(host.container.querySelector('[role="alert"]')).toBeNull()
  } finally {host.dispose()}
  expect(signal?.aborted).toBeTrue()
})

test("единое окно сохраняет черновик каталогов при смене раздела", async () => {
  let saves = 0
  const host = await mount({read: async () => configured, save: async () => {saves++
    return configured}})
  try {
    await host.click("Настройки")
    await edit(host, 0, "/draft/projects")
    const field = fields(host)[0]!
    await host.click("Провайдеры")
    expect(host.container.querySelectorAll("[data-window]")).toHaveLength(1)
    expect(host.container.querySelector('[role="tabpanel"]')?.getAttribute("aria-label")).toBe("Провайдеры")
    await host.click("Каталоги")
    expect(fields(host)[0]).toBe(field)
    expect(field.value).toBe("/draft/projects")
    expect(saves).toBe(0)
  } finally {host.dispose()}
})
