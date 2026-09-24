import {afterAll, describe, expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpWindowProps} from "../index"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {command, createWindowHost, largeResponse} from "./fixture"
import {defaultMcpWindowState} from "../src/state"

const {McpWindow} = await import("../index.tsx")

describe.each([
  {name: "Восстановление открытого окна", open: true},
  {name: "Восстановление закрытого окна", open: false},
])("$name", async ({open}) => {
  const host = createWindowHost()
  afterAll(() => host.dispose())
  const initialState = {...defaultMcpWindowState(), open, mode: "address" as const, geometry: {x: 64, y: 54, width: 690, height: 480}}
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {open, initialState, onClose() {}})
  await host.settle()
  test("Видимость", () => {
    expect(host.container.querySelector('[data-mcp-window]')!.hasAttribute("hidden"), "Окно восстанавливает сохранённую видимость").toBe(!open)
  })
  test("Режим", () => {
    expect(host.button("Текущий адрес → MCP").hasAttribute("disabled"), "Сохранённый режим выбран при первом отображении").toBeTrue()
  })
  test.skipIf(!open)("Геометрия", () => {
    expect(host.bounds(host.container.querySelector('[data-mcp-window]')!), "Сохранённые положение и размер").toEqual(initialState.geometry)
  })
})

describe.each([{name: "Два режима MCP", address: "/storybook/archetypes?view=scenarios&variant=Пример"}])("$name", async ({address}) => {
  const host = createWindowHost()
  afterAll(() => host.dispose())
  const requests: string[] = []
  const input = {path: "storybook/archetypes"}
  const response = {path: input.path, title: "Archetypes", packages: []}
  const props: McpWindowProps = {open: true, onClose() {}, load: async () => [command("agent")], addressSource: {
    readAddress: () => address,
    async request(address) {
      requests.push(address)
      return {input, result: response, failed: false}
    },
  }}
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
  await host.settle()
  const agent = host.container.querySelector("article")?.textContent
  await host.click("Текущий адрес → MCP")
  const codes = host.container.querySelector('[data-mcp-address]')!.querySelectorAll("code")
  test("Вызовы агента", () => {
    expect(agent, "Первый режим показывает настоящее обращение из источника журнала").toContain("storybook-agent")
  })
  test("Адрес", () => {
    expect(requests, "Адрес страницы используется для определения пакета-владельца").toEqual([address])
  })
  test("Запрос и ответ", () => {
    expect([...codes].map(code => JSON.parse(code.textContent)), "Второй режим показывает точный запрос и полный публичный ответ").toEqual([input, response])
  })
})

describe.each([
  {name: "Пустой журнал", open: true, entries: [], error: null},
  {name: "Выполнение команды", open: true, entries: [command("running", "running", "")], error: null},
  {name: "Готовый ответ", open: true, entries: [command("ready")], error: null},
  {name: "Большой ответ", open: true, entries: [command("large", "success", largeResponse)], error: null},
  {name: "Ошибка команды", open: true, entries: [command("failed", "failed", '{"error":"Проверка не выполнена"}')], error: null},
  {name: "История команд", open: true, entries: Array.from({length: 20}, (_, index) => command(String(index))), error: null},
  {name: "Ошибка загрузки журнала", open: true, entries: [], error: "Журнал временно недоступен"},
  {name: "Закрытое окно", open: false, entries: [command("hidden")], error: null},
] satisfies {name: string, open: boolean, entries: McpRequestRecord[], error: string | null}[])("$name", async ({open, entries, error}) => {
  const host = createWindowHost()
  afterAll(() => host.dispose())
  let loads = 0
  const props: McpWindowProps = {open, onClose() {}, load: async () => {
    loads++
    if (error !== null) throw new Error(error)
    return entries
  }}
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
  const frame = await host.settle()
  const initialLoads = loads
  const element = host.container.querySelector('[data-mcp-window]')!
  const codes = [...element.querySelectorAll("code")].map(code => code.textContent)
  const item = element.querySelector("article")
  const first = open && error === null ? entries[0] : undefined

  describe("Окно", () => {
    test("Назначение", () => {
      expect({role: element.getAttribute("role"), label: element.getAttribute("aria-label")}, "Окно просмотра команд и полных ответов MCP").toEqual({role: "dialog", label: "Журнал MCP"})
    })
    test("Видимость", () => {
      expect(frame.boxByNode.has(element), "Отображение окна определяется входным open").toBe(open)
    })
    test("Загрузка", () => {
      expect(initialLoads, "Чтение журнала при открытии; закрытое окно не обращается к источнику").toBe(open ? 1 : 0)
    })
    /** @remarks Геометрия скрытого окна не участвует в раскладке. */
    test.skipIf(!open)("Размер и положение", () => {
      expect(host.bounds(element), "Начальное положение и размер окна в рабочей области").toEqual({x: 24, y: 24, width: 620, height: 400})
    })
  })
  describe("Команда", () => {
    test("Количество", () => {
      expect(element.querySelectorAll("article").length, "Одна выбранная команда независимо от размера истории").toBe(first ? 1 : 0)
    })
    test("Параметры и ответ", () => {
      expect(codes, "Полные параметры и весь ответ выбранной команды без усечения и постраничного деления").toEqual(first ? [JSON.stringify(JSON.parse(first.input), null, 2), first.result ? JSON.stringify(JSON.parse(first.result), null, 2) : ""] : [])
    })
    /** @remarks Состояние команды применимо, когда источник вернул хотя бы одну запись. */
    test.skipIf(!first)("Состояние", () => {
      expect(item?.textContent, "Статус выполнения выбранной команды").toContain(` · ${first!.status} · `)
    })
  })
  describe("Доступность источника", () => {
    test("Ошибка", () => {
      const messages = [...element.querySelectorAll("div")].filter(node => node.textContent === error && frame.boxByNode.has(node)).map(node => node.textContent)
      expect(messages, "Ошибка чтения журнала отдельно от результата команды").toEqual(error && open ? [error] : [])
    })
  })
})

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
