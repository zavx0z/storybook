import {afterAll, describe, expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpWindowProps} from "../index"
import {createWindowHost} from "../spec/fixture"
import {command} from "../spec/fixture/records"

const {McpWindow} = await import("../index.tsx")

describe.each([{name: "Работа с окном", entries: [command("latest"), command("previous")]}])("$name", async ({entries}) => {
  const host = createWindowHost()
  afterAll(() => host.dispose())
  let closeRequests = 0
  const props: McpWindowProps = {open: true, onClose: () => { closeRequests++ }, load: async () => entries}
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
  await host.settle()
  const element = host.container.querySelector('[data-mcp-window]')!

  await host.click("Предыдущая команда")
  const previous = host.container.querySelectorAll("code")[1]!.textContent
  await host.click("Следующая команда")
  const next = host.container.querySelectorAll("code")[1]!.textContent
  await host.click("Следить за последней")
  const following = host.button("Следить за последней").hasAttribute("disabled")

  describe("История", () => {
    test("Предыдущая команда", () => {
      expect(previous, "Полный ответ более ранней команды из сохранённой истории").toBe(entries[1]!.result)
    })
    test("Следующая команда", () => {
      expect(next, "Возврат к более новой команде без изменения её данных").toBe(entries[0]!.result)
    })
    test("Последняя команда", () => {
      expect(following, "Режим автоматического показа последних поступающих команд").toBeTrue()
    })
  })

  const code = host.container.querySelector("code")!
  const minimizedFrame = await host.click("Minimize")
  const minimized = !minimizedFrame.boxByNode.has(code)
  const restoredFrame = await host.click("Restore")
  const restored = restoredFrame.boxByNode.has(code)
  describe("Содержимое", () => {
    test("Сворачивание", () => {
      expect(minimized, "Скрытое содержимое окна при сохранении журнала").toBeTrue()
    })
    test("Восстановление", () => {
      expect(restored, "Повторное отображение сохранённого содержимого").toBeTrue()
    })
  })

  let frame = await host.settle()
  const title = [...element.querySelectorAll("span")].find(node => node.textContent === "Журнал MCP")!
  const titleBox = host.bounds(title)
  const point = {clientX: titleBox.x + titleBox.width / 2, clientY: titleBox.y + titleBox.height / 2, pointerId: 1}
  host.input.pointerDown(frame, point)
  host.input.pointerMove(frame, {...point, clientX: point.clientX + 40, clientY: point.clientY + 30, buttons: 1})
  frame = await host.settle()
  host.input.pointerUp(frame, {...point, clientX: point.clientX + 40, clientY: point.clientY + 30})
  await host.settle()
  const moved = host.bounds(element)
  const handle = host.bounds(host.button("Изменить размер окна MCP"))
  const resizePoint = {clientX: handle.x + 10, clientY: handle.y + 10, pointerId: 2}
  frame = await host.settle()
  host.input.pointerDown(frame, resizePoint)
  host.input.pointerMove(frame, {...resizePoint, clientX: resizePoint.clientX + 60, clientY: resizePoint.clientY + 40, buttons: 1})
  frame = await host.settle()
  host.input.pointerUp(frame, {...resizePoint, clientX: resizePoint.clientX + 60, clientY: resizePoint.clientY + 40})
  await host.settle()
  const resized = host.bounds(element)

  describe("Геометрия", () => {
    test("Перемещение", () => {
      expect(moved, "Положение окна после перетаскивания заголовка").toEqual({x: 64, y: 54, width: 620, height: 400})
    })
    test("Размер", () => {
      expect(resized, "Габариты окна после перетаскивания нижней правой ручки").toEqual({x: 64, y: 54, width: 680, height: 440})
    })
  })

  await host.click("Закрыть")
  const requested = closeRequests
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {...props, open: false})
  const closed = !(await host.settle()).boxByNode.has(element)
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
  const reopened = (await host.settle()).boxByNode.has(element)
  describe("Управление видимостью", () => {
    test("Запрос закрытия", () => {
      expect(requested, "Уведомление родителя через onClose").toBe(1)
    })
    test("Закрытие", () => {
      expect(closed, "Скрытие окна после передачи open=false родителем").toBeTrue()
    })
    test("Повторное открытие", () => {
      expect(reopened, "Возвращение окна после передачи open=true").toBeTrue()
    })
  })
})

describe.each([{name: "Выделение JSON поверх соседней панели"}])("$name", async () => {
  const host = createWindowHost()
  const entry = command("selection", "success", JSON.stringify({description: "Путь к сценарию"}))
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {open: true, onClose() {}, load: async () => [entry]})
    let frame = await host.settle()
    const code = host.container.querySelectorAll("code")[1]!
    const text = frame.displayList.find(item => item.kind === "text" && code.contains(item.node) && item.text.includes("Путь"))!
    if (text.kind !== "text") throw new Error("Нет текста ответа")
    const background = host.document.createElement("div")
    background.setAttribute("style", `position:absolute;left:0;top:${text.y + text.lineHeight}px;width:1000px;height:20px;font-size:14px;line-height:20px`)
    background.textContent = "Текст соседней панели ".repeat(20)
    host.container.insertBefore(background, host.container.firstChild)
    frame = await host.settle()
    const point = {
      clientX: text.x + (text.width ?? 100) * (text.text.indexOf("Путь") / text.text.length),
      clientY: text.y + text.lineHeight / 2,
      pointerId: 21,
      buttons: 1,
    }
    host.input.pointerDown(frame, point)
    const startedInCode = code.contains(host.document.getSelection().anchorNode)
    const end = {...point, clientX: point.clientX + 100, clientY: point.clientY + text.lineHeight}
    host.input.pointerMove(frame, end)
    host.input.pointerUp(frame, {...end, buttons: 0})
    const selection = host.document.getSelection()
    const anchorInCode = code.contains(selection.anchorNode)
    const focusInCode = code.contains(selection.focusNode)
    const selected = selection.toString()
    test("Начало у слова Путь", () => {
      expect(startedInCode, "Нажатие начинает выделение внутри ответа").toBeTrue()
      expect(selected.startsWith("Путь к сценарию"), "Выделенный текст начинается у выбранного слова").toBeTrue()
    })
    test("Граница поля", () => {
      expect(anchorInCode && focusInCode, "Оба конца диапазона остаются в JSON-поле").toBeTrue()
      expect(selected, "Фоновая панель не попадает в выделение").not.toContain("Текст соседней панели")
      expect(selected, "Заголовок окна не попадает в выделение").not.toContain("Журнал MCP")
    })
  } finally {
    host.dispose()
  }
})
