import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpWindowProps} from "../index"
import {createMcpWindowPersistence, defaultMcpWindowState} from "../src/state"
import {createWindowHost} from "../spec/fixture"

const {McpWindow} = await import("../index.tsx")

test("перемещение, размер, режим и закрытие переживают создание нового окна", async () => {
  let saved: string | null = null
  const storage = () => ({getItem: () => saved, setItem: (_key: string, value: string) => { saved = value }})
  let host = createWindowHost()
  const mount = async () => {
    const persistence = createMcpWindowPersistence(storage)
    const props: McpWindowProps = {
      open: persistence.initialState.open,
      initialState: persistence.initialState,
      onStateChange: persistence.save,
      onClose() {
        host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {...props, open: false})
      },
    }
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
    return host.settle()
  }
  createMcpWindowPersistence(storage).save({...defaultMcpWindowState(), open: true})
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

test("повреждённое или запрещённое хранилище не мешает открытию окна", () => {
  const blocked = createMcpWindowPersistence(() => { throw new Error("Storage disabled") })
  expect(blocked.initialState).toEqual(defaultMcpWindowState())
  expect(() => blocked.save(defaultMcpWindowState())).not.toThrow()
  const broken = createMcpWindowPersistence(() => ({getItem: () => "{", setItem() {}}))
  expect(broken.initialState).toEqual(defaultMcpWindowState())
  const partial = createMcpWindowPersistence(() => ({getItem: () => JSON.stringify({open: true, mode: "invalid", geometry: {x: -10, y: "bad", width: 1, height: null}}), setItem() {}}))
  expect(partial.initialState).toEqual({open: true, mode: "agent", geometry: {x: 0, y: 24, width: 320, height: 400}})
})


test("старое сворачивание шапки восстанавливается как скрытое окно", () => {
  const state = createMcpWindowPersistence(() => ({getItem: () => JSON.stringify({open: true, minimized: true}), setItem() {}}))
  expect(state.initialState.open).toBeFalse()
})
