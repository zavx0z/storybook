import {afterEach, beforeEach, describe, expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpWindowProps} from "../index"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {command, createWindowHost, largeResponse} from "../spec/fixture"

const {McpWindow} = await import("../index.tsx")
let host: ReturnType<typeof createWindowHost>
beforeEach(() => { host = createWindowHost() })
afterEach(() => host.dispose())

const render = async (props: McpWindowProps) => {
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
  return host.settle()
}
const resultText = () => host.container.querySelectorAll("code")[1]?.textContent ?? ""
const window = () => host.container.querySelector('[data-mcp-window]')!

describe("Открытие и завершение", () => {
  test("закрытие передаётся родителю, повторное открытие читает свежий журнал", async () => {
    let closeRequests = 0
    let loads = 0
    let entries = [command("first")]
    const props: McpWindowProps = {open: false, onClose: () => { closeRequests++ }, load: async () => { loads++; return entries }}
    await render(props)
    expect(loads).toBe(0)
    await render({...props, open: true})
    expect(resultText()).toBe(entries[0]!.result)
    await host.click("Закрыть")
    expect(closeRequests).toBe(1)
    expect(window().hasAttribute("hidden")).toBeFalse()
    await render(props)
    expect(window().hasAttribute("hidden")).toBeTrue()
    const before = loads
    await Bun.sleep(1100)
    expect(loads).toBe(before)
    entries = [command("second")]
    await render({...props, open: true})
    expect(resultText()).toBe(entries[0]!.result)
  })

  test("сворачивание скрывает содержимое и resize, восстановление сохраняет полный ответ", async () => {
    const entry = command("ready")
    await render({open: true, onClose() {}, load: async () => [entry]})
    const code = host.container.querySelector("code")!
    const minimized = await host.click("Minimize")
    expect(minimized.boxByNode.has(code)).toBeFalse()
    expect(host.button("Изменить размер окна MCP").hasAttribute("hidden")).toBeTrue()
    const restored = await host.click("Restore")
    expect(restored.boxByNode.has(code)).toBeTrue()
    expect(resultText()).toBe(entry.result)
  })

  test("ответ старого источника не заменяет новый после смены load", async () => {
    const pending = Promise.withResolvers<readonly McpRequestRecord[]>()
    await render({open: true, onClose() {}, load: () => pending.promise})
    const current = command("current")
    await render({open: true, onClose() {}, load: async () => [current]})
    pending.resolve([command("stale")])
    await host.settle()
    expect(resultText()).toBe(current.result)
  })

  test("ответ после закрытия не обновляет скрытое окно", async () => {
    const pending = Promise.withResolvers<readonly McpRequestRecord[]>()
    const props: McpWindowProps = {open: true, onClose() {}, load: () => pending.promise}
    await render(props)
    await render({...props, open: false})
    pending.resolve([command("late")])
    await host.settle()
    expect(host.container.querySelectorAll("article")).toHaveLength(0)
  })

  test("после unmount прекращаются опрос и обработка незавершённого запроса", async () => {
    let loads = 0
    const pending = Promise.withResolvers<readonly McpRequestRecord[]>()
    await render({open: true, onClose() {}, load: () => { loads++; return pending.promise }})
    host.dispose()
    pending.resolve([command("late")])
    await Bun.sleep(1100)
    expect(loads).toBe(1)
    expect(host.container.childNodes).toHaveLength(0)
  })
})

describe("Обновление журнала", () => {
  test("новый опрос не начинается до завершения предыдущего", async () => {
    let loads = 0
    const pending = Promise.withResolvers<readonly McpRequestRecord[]>()
    await render({open: true, onClose() {}, load: () => { loads++; return pending.promise }})
    await Bun.sleep(1100)
    expect(loads).toBe(1)
    pending.resolve([command("done")])
    await host.waitFor(() => resultText() !== "")
    expect(resultText()).toBe(command("done").result)
  })

  test("ошибка загрузки сохраняет прежний ответ и исчезает после восстановления", async () => {
    let broken = false
    let entries = [command("first")]
    await render({open: true, onClose() {}, load: async () => {
      if (broken) throw new Error("Источник недоступен")
      return entries
    }})
    broken = true
    await host.waitFor(() => host.container.textContent.includes("Источник недоступен"))
    expect(resultText()).toBe(entries[0]!.result)
    entries = [command("recovered")]
    broken = false
    await host.waitFor(() => resultText() === entries[0]!.result)
    expect(host.container.textContent).not.toContain("Источник недоступен")
  })

  test("неизменённый ответ не пересоздаёт редакторы на каждом опросе", async () => {
    let loads = 0
    const entry = command("same")
    await render({open: true, onClose() {}, load: async () => { loads++; return [{...entry}] }})
    const code = host.container.querySelectorAll("code")[1]
    await host.waitFor(() => loads >= 2)
    expect(host.container.querySelectorAll("code")[1]).toBe(code)
    expect(resultText()).toBe(entry.result)
  })
})

describe("Большие ответы", () => {
  test("running переходит в полный ответ, история переключается и выбранная команда обновляется", async () => {
    const full = command("long", "success", largeResponse)
    const older = command("older", "success", JSON.stringify({text: "Другой большой ответ ".repeat(6000)}, null, 2))
    let entries = [command("long", "running", ""), older, ...Array.from({length: 18}, (_, index) => command(`extra-${index}`, "success", largeResponse))]
    await render({open: true, onClose() {}, load: async () => entries})
    expect(resultText()).toBe("")
    entries = [full, ...entries.slice(1)]
    await host.waitFor(() => resultText() === full.result, 15000)
    expect(host.container.querySelectorAll("article")).toHaveLength(1)
    expect(resultText()).toBe(full.result)
    await host.click("Предыдущая команда")
    expect(resultText()).toBe(older.result)
    const changed = {...older, result: JSON.stringify({updated: true, text: "Полный обновлённый ответ".repeat(1000)}, null, 2)}
    entries = [command("new"), full, changed, ...entries.slice(2, 19)]
    await host.waitFor(() => resultText() === changed.result, 15000)
    expect(host.container.querySelectorAll("article")).toHaveLength(1)
    expect(resultText()).toBe(changed.result)
    await host.click("Следить за последней")
    expect(resultText()).toBe(entries[0]!.result)
    await host.click("Закрыть")
  }, 30000)
})

describe("Положение и размер", () => {
  test("отмена перетаскивания освобождает capture и прекращает движение", async () => {
    let frame = await render({open: true, onClose() {}, load: async () => []})
    const title = [...host.container.querySelectorAll("span")].find(node => node.textContent === "Журнал MCP")!
    const box = host.bounds(title)
    const point = {clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 5}
    host.input.pointerDown(frame, point)
    host.input.pointerMove(frame, {...point, clientX: point.clientX - 1000, clientY: point.clientY - 1000, buttons: 1})
    frame = await host.settle()
    expect(host.bounds(window())).toEqual({x: 0, y: 0, width: 620, height: 400})
    host.input.pointerCancel(frame, point)
    host.input.pointerMove(frame, {...point, clientX: point.clientX + 200, clientY: point.clientY + 200, buttons: 1})
    await host.settle()
    expect(host.bounds(window())).toEqual({x: 0, y: 0, width: 620, height: 400})
    expect(window().hasPointerCapture(5)).toBeFalse()
  })

  test("перетаскивание заголовка изменяет положение и освобождает pointer capture", async () => {
    let frame = await render({open: true, onClose() {}, load: async () => []})
    const title = [...host.container.querySelectorAll("span")].find(node => node.textContent === "Журнал MCP")!
    const box = host.bounds(title)
    const point = {clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 7}
    host.input.pointerDown(frame, point)
    host.input.pointerMove(frame, {...point, clientX: point.clientX + 40, clientY: point.clientY + 30, buttons: 1})
    frame = await host.settle()
    host.input.pointerUp(frame, {...point, clientX: point.clientX + 40, clientY: point.clientY + 30})
    await host.settle()
    expect(host.bounds(window())).toEqual({x: 64, y: 54, width: 620, height: 400})
    expect(window().hasPointerCapture(7)).toBeFalse()
  })

  test("resize изменяет размер окна, соблюдает минимум и прекращается после pointerup", async () => {
    let frame = await render({open: true, onClose() {}, load: async () => []})
    const box = host.bounds(host.button("Изменить размер окна MCP"))
    const point = {clientX: box.x + 10, clientY: box.y + 10, pointerId: 9}
    host.input.pointerDown(frame, point)
    host.input.pointerMove(frame, {...point, clientX: point.clientX + 70, clientY: point.clientY + 80, buttons: 1})
    frame = await host.settle()
    expect(host.bounds(window())).toEqual({x: 24, y: 24, width: 690, height: 480})
    host.input.pointerMove(frame, {...point, clientX: point.clientX - 1000, clientY: point.clientY - 1000, buttons: 1})
    frame = await host.settle()
    expect(host.bounds(window())).toEqual({x: 24, y: 24, width: 320, height: 200})
    host.input.pointerUp(frame, point)
    host.input.pointerMove(frame, {...point, clientX: point.clientX + 300, buttons: 0})
    await host.settle()
    expect(host.bounds(window())).toEqual({x: 24, y: 24, width: 320, height: 200})
    expect(window().hasPointerCapture(9)).toBeFalse()
  })
})
