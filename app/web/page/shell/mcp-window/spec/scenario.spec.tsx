import {afterAll, describe, expect, mock, test} from "bun:test"
import McpWindow from "../index"
import {command} from "./fixture/records"
import {createHeadless} from "@zavx0z/immersive-headless"
import {MouseEvent} from "@zavx0z/immersive-dom"

describe.each([
  {name: "Пустой журнал", props: {open: true, entries: []}},
  {name: "Выполнение команды", props: {open: true, entries: [command("running", "running", "")]}},
  {name: "Готовый ответ", props: {open: true, entries: [command("ready")]}},
  {name: "Многострочный ответ", props: {open: true, entries: [command("multiline", "success", JSON.stringify({description: "Описание сценария\nПродолжение описания", input: {description: "Путь к сценарию", type: "string"}}, null, 2))]}},
  {name: "Ошибка команды", props: {open: true, entries: [command("failed", "failed", '{"error":"Проверка не выполнена"}')]}},
  {name: "История команд", props: {open: true, entries: Array.from({length: 20}, (_, index) => command(String(index)))}},
  {name: "Закрытое окно", props: {open: false, entries: [command("hidden")]}},
  {name: "Восстановление открытого окна", props: {open: true, entries: [], initialState: {open: true, mode: "address" as const, geometry: {x: 64, y: 54, width: 690, height: 480}}}},
  {name: "Восстановление закрытого окна", props: {open: false, entries: [], initialState: {open: false, mode: "address" as const, geometry: {x: 64, y: 54, width: 690, height: 480}}}},
  {name: "Контекст и вызовы", props: {open: true, entries: [command("agent")], address: "/storybook/archetypes?view=scenarios&variant=Пример"}},
])("$name", async ({props: input}) => {
  const headless = createHeadless({width: 1000, height: 800})
  afterAll(() => headless.dispose())
  const props = {
    ...input,
    onClose: mock(),
    load: mock(async () => input.entries),
    addressSource: {
      readAddress: () => input.address ?? "/storybook/archetypes",
      request: mock(async (address: string, signal: AbortSignal) => ({
        input: {path: "storybook/archetypes"},
        result: {path: "storybook/archetypes", title: "Archetypes", packages: []},
        failed: false,
      })),
    },
  }
  const element = await headless.render(
    <McpWindow
      open={props.open}
      initialState={props.initialState}
      onClose={props.onClose}
      load={props.load}
      addressSource={props.addressSource}
    />,
  )
  const shell = element.querySelector("[data-window]")!
  const initialLoads = props.load.mock.calls.slice()
  const button = (name: string) => [...element.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === name || button.textContent === name)!
  const click = async (name: string) => {
    button(name).dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
  }
  const mode = input.initialState?.mode ?? "agent"
  const first = input.open && mode === "agent" ? input.entries[0] : undefined

  test("Назначение", () => {
    expect({role: shell.getAttribute("role"), label: shell.getAttribute("aria-label")},
      "Окно контекста и полных ответов").toEqual({role: "dialog", label: "Среда"})
  })
  test("Видимость", () => {
    expect(!shell.hasAttribute("hidden"), "Окно отображается при open=true").toBe(input.open)
  })
  test("Источник журнала", () => {
    expect(initialLoads.length > 0, "Открытый журнал читает источник; скрытое окно и адресный режим не запрашивают журнал").toBe(input.open && mode === "agent")
  })
  test("Режим", () => {
    expect(button(mode === "agent" ? "Вызовы" : "Контекст").hasAttribute("disabled"),
      "Выбранный режим восстанавливается из начального состояния").toBeTrue()
  })

  /** @remarks Геометрия и действия применимы к открытому окну; скрытое окно не участвует в раскладке. */
  describe.skipIf(!input.open)("Открытое окно", () => {
    test("Положение и размер", () => {
      expect(shell.getBoundingClientRect().toJSON(), "Окно использует сохранённую геометрию либо начальные размеры").toMatchObject(input.initialState?.geometry ?? {x: 24, y: 24, width: 620, height: 400})
    })
    test("Запрос закрытия", async () => {
      await click("Скрыть Среда")
      expect(props.onClose.mock.calls, "Окно передаёт запрос родителю через onClose").toEqual([[]])
      expect(shell.hasAttribute("hidden"), "Видимость остаётся под управлением переданного open").toBeFalse()
    })
  })

  /** @remarks Журнал и его записи доступны в режиме вызовов агента. */
  describe.skipIf(!input.open || mode !== "agent")("Журнал", () => {
    test("Количество", () => {
      expect(element.querySelectorAll("article").length, "Отображается одна выбранная команда независимо от размера истории").toBe(first ? 1 : 0)
    })
    test("Полные данные", () => {
      expect([...element.querySelectorAll("code")].map(code => code.textContent),
        "Параметры и ответ совпадают с записью агента после форматирования JSON").toEqual(first
        ? [JSON.stringify(JSON.parse(first.input), null, 2), first.result ? JSON.stringify(JSON.parse(first.result), null, 2) : ""]
        : [])
    })
  })

  /** @remarks Состояние команды существует, когда открытый журнал содержит запись. */
  describe.skipIf(!first)("Выбранная команда", () => {
    test("Состояние", () => {
      expect(element.querySelector("article")?.textContent, "Статус выполнения выбранной команды").toContain(` · ${first!.status} · `)
    })

  })

  /** @remarks Навигация по истории имеет смысл при нескольких командах. */
  describe.skipIf(!input.open || input.entries.length < 2)("История", () => {
    test("Выбор команды", async () => {
      await click("Предыдущий вызов")
      expect(element.querySelectorAll("code")[1]?.textContent, "Полный ответ предыдущей записи").toBe(input.entries[1]!.result)
      await click("Следующий вызов")
      expect(element.querySelectorAll("code")[1]?.textContent, "Возврат к последней записи").toBe(input.entries[0]!.result)
      await click("Следить за последней")
      expect(button("Следить за последней").hasAttribute("disabled"), "Слежение за новыми командами восстановлено").toBeTrue()
    })
  })

  /** @remarks Смена режима показана в варианте с явным адресом страницы. */
  describe.skipIf(!input.address)("Текущий адрес", () => {
    test("Запрос и ответ", async () => {
      expect(element.querySelector("article")?.textContent, "Первоначально виден вызов агента").toContain("storybook-agent")
      await click("Контекст")
      expect(props.addressSource.request.mock.calls, "Обработчик получает текущий адрес страницы").toEqual([[input.address!, expect.any(AbortSignal)]])
      expect([...element.querySelector('[data-mcp-address]')!.querySelectorAll("code")].map(code => JSON.parse(code.textContent)),
        "Адресный режим показывает точный запрос и полный публичный ответ").toEqual([
        {path: "storybook/archetypes"},
        {path: "storybook/archetypes", title: "Archetypes", packages: []},
      ])
      await click("Вызовы")
    })
  })
})
