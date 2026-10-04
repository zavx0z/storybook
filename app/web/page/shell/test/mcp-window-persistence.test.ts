import McpWindow from "@zavx0z/storybook-app-web-page-shell-mcp-window"
import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import type {Zavx0zStorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"
type McpWindowProps = Zavx0zStorybookAppWebPageShellMcpWindow.Input
import {createMcpWindowPersistence} from "../src/mcp-window-persistence"
import {createWindowHost} from "./fixture/mcp-window-host"

const initialLayout: Zavx0zStorybookAppWebPageShellMcpWindow.Output = {open: false, mode: "agent", geometry: {x: 24, y: 24, width: 620, height: 400}}


test("перемещение, размер, режим и закрытие переживают создание нового окна", async () => {
  let saved: string | null = null
  const storage = () => ({getItem: () => saved, setItem: (_key: string, value: string) => { saved = value }})
  let host = createWindowHost()
  const mount = async () => {
    const persistence = createMcpWindowPersistence(storage)
    const props: McpWindowProps = {
      open: persistence.initialState?.minimized !== true && persistence.initialState?.open === true,
      initialState: persistence.initialState,
      onStateChange: persistence.save,
      onClose() {
        host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {...props, open: false})
      },
    }
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
    return host.settle()
  }
  createMcpWindowPersistence(storage).save({...initialLayout, open: true})
  try {
    let frame = await mount()
    const title = [...host.container.querySelectorAll("span")].find(node => node.textContent === "Журнал MCP")!
    const box = host.bounds(title)
    const point = {clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 7}
    host.input.pointerDown(frame, point)
    host.input.pointerMove(frame, {...point, clientX: point.clientX + 40, clientY: point.clientY + 30, buttons: 1})
    frame = await host.settle()
    host.input.pointerUp(frame, {...point, clientX: point.clientX + 40, clientY: point.clientY + 30})
    frame = await host.settle()
    const resize = host.bounds(host.container.querySelector('[data-window-resize="se"]')!)
    const handle = {clientX: resize.x + 5, clientY: resize.y + 5, pointerId: 8}
    host.input.pointerDown(frame, handle)
    host.input.pointerMove(frame, {...handle, clientX: handle.clientX + 70, clientY: handle.clientY + 80, buttons: 1})
    frame = await host.settle()
    host.input.pointerUp(frame, {...handle, clientX: handle.clientX + 70, clientY: handle.clientY + 80})
    await host.click("Текущий адрес → MCP")
    expect(createMcpWindowPersistence(storage).initialState).toEqual({open: true, mode: "address", geometry: {x: 64, y: 54, width: 690, height: 480}})
    host.dispose()
    host = createWindowHost()
    await mount()
    const element = host.container.querySelector('[data-window]')!
    expect(element.hasAttribute("hidden")).toBeFalse()
    expect(host.bounds(element)).toEqual({x: 64, y: 54, width: 690, height: 480})
    expect(host.button("Текущий адрес → MCP").hasAttribute("disabled")).toBeTrue()
    await host.click("Скрыть Журнал MCP")
    host.dispose()
    host = createWindowHost()
    await mount()
    expect(host.container.querySelector('[data-window]')!.hasAttribute("hidden")).toBeTrue()
    expect(createMcpWindowPersistence(storage).initialState).toEqual({open: false, mode: "address", geometry: {x: 64, y: 54, width: 690, height: 480}})
  } finally {
    host.dispose()
  }
})

test("повреждённое или запрещённое хранилище не мешает открытию окна", async () => {
  const blocked = createMcpWindowPersistence(() => { throw new Error("Storage disabled") })
  expect(blocked.initialState).toBeUndefined()
  expect(() => blocked.save(initialLayout)).not.toThrow()
  const broken = createMcpWindowPersistence(() => ({getItem: () => "{", setItem() {}}))
  expect(broken.initialState).toBeUndefined()
  const partial = createMcpWindowPersistence(() => ({getItem: () => JSON.stringify({open: true, mode: "invalid", geometry: {x: -10, y: "bad", width: 1, height: null}}), setItem() {}}))
  const host = createWindowHost()
  let normalized: Zavx0zStorybookAppWebPageShellMcpWindow.Output | undefined
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {
      open: true,
      onClose() {},
      initialState: partial.initialState,
      onStateChange(state) { normalized = state },
    })
    await host.settle()
    expect(normalized, "Окно дополняет частично повреждённые сохранённые настройки").toEqual({open: true, mode: "agent", geometry: {x: 0, y: 24, width: 320, height: 400}})
  } finally { host.dispose() }
})


test("старое сворачивание шапки восстанавливается как скрытое окно", async () => {
  const state = createMcpWindowPersistence(() => ({getItem: () => JSON.stringify({open: true, minimized: true}), setItem() {}}))
  const host = createWindowHost()
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {
      open: state.initialState?.minimized !== true && state.initialState?.open === true,
      onClose() {},
      initialState: state.initialState,
    })
    await host.settle()
    expect(host.container.querySelector("[data-window]")!.hasAttribute("hidden"), "Старое сворачивание оставляет окно закрытым").toBeTrue()
  } finally { host.dispose() }
})
