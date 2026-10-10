import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Event, KeyboardEvent, MouseEvent, type HTMLInputElement} from "@zavx0z/immersive"
import CatalogPanel, {type StorybookAppWebPageShellWorkbenchCatalog} from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"

const items = [
  {id: "button", label: "Кнопка", route: "/button", group: {id: "components", label: "Компоненты"}},
  {id: "tab", label: "Tab", route: "/tab", group: {id: "components", label: "Компоненты"}},
] as const

type Scenario = Readonly<{
  name: string
  props: Omit<StorybookAppWebPageShellWorkbenchCatalog.Input, "onAction" | "onSearch" | "onGroupToggle" | "navigationExpansion"> & {
    navigationExpansion: Pick<NonNullable<StorybookAppWebPageShellWorkbenchCatalog.Input["navigationExpansion"]>, "initialCollapsedIds">
  }
  expected: Readonly<{
    expanded: boolean
    rows: readonly string[]
    expandedRows: readonly string[]
  }>
}>

describe.each([
  {
    name: "Ветка",
    props: {
      label: "Ветка",
      items,
      activeId: "button",
      search: "",
      showSearch: false,
      defaultCollapsed: false,
      management: null,
      navigationExpansion: {initialCollapsedIds: []},
    },
    expected: {
      expanded: true,
      rows: ["group:components", "button", "tab"],
      expandedRows: ["group:components", "button", "tab"],
    },
  },
  {
    name: "Поиск по каталогу",
    props: {
      label: "Каталог",
      items,
      activeId: "button",
      search: "Кнопка",
      showSearch: true,
      defaultCollapsed: false,
      management: null,
      navigationExpansion: {initialCollapsedIds: []},
    },
    expected: {
      expanded: true,
      rows: ["group:components", "button"],
      expandedRows: ["group:components", "button"],
    },
  },
  {
    name: "Восстановленная свёрнутая ветка",
    props: {
      label: "Ветка",
      items,
      activeId: "button",
      search: "",
      showSearch: false,
      defaultCollapsed: false,
      management: null,
      navigationExpansion: {initialCollapsedIds: ["components"]},
    },
    expected: {
      expanded: false,
      rows: ["group:components"],
      expandedRows: ["group:components", "button", "tab"],
    },
  },
  {
    name: "Свёрнуто без сохранённого состояния",
    props: {
      label: "Каталог",
      items,
      activeId: "button",
      search: "",
      showSearch: true,
      defaultCollapsed: true,
      management: null,
      navigationExpansion: {},
    },
    expected: {
      expanded: false,
      rows: ["group:components"],
      expandedRows: ["group:components", "button", "tab"],
    },
  },
  {
    name: "Сохранённое раскрытие важнее начального состояния",
    props: {
      label: "Каталог",
      items,
      activeId: "button",
      search: "",
      showSearch: true,
      defaultCollapsed: true,
      management: null,
      navigationExpansion: {initialCollapsedIds: []},
    },
    expected: {
      expanded: true,
      rows: ["group:components", "button", "tab"],
      expandedRows: ["group:components", "button", "tab"],
    },
  },
] satisfies readonly Scenario[])("$name", async ({name, props: input, expected}: Scenario) => {
  const headless = createHeadless({width: 360, height: 480})
  afterAll(() => headless.dispose())
  const props = {
    ...input,
    onAction: mock(),
    onSearch: mock(),
    onGroupToggle: mock(),
    navigationExpansion: {
      ...input.navigationExpansion,
      save: mock(),
    },
  }
  const element = await headless.render(
    <CatalogPanel
      label={props.label}
      items={props.items}
      activeId={props.activeId}
      search={props.search}
      showSearch={props.showSearch}
      defaultCollapsed={props.defaultCollapsed}
      management={props.management}
      navigationExpansion={props.navigationExpansion}
      onAction={props.onAction}
      onSearch={props.onSearch}
      onGroupToggle={props.onGroupToggle}
    />,
  )

  test("Границы панели", () => {
    const bounds = element.getBoundingClientRect()
    expect(element.localName, "Section задаёт границу панели внутри принимающей области").toBe("section")
    expect({width: bounds.width, height: bounds.height}, "Панель занимает отведённые 360 × 480 px без прибавления высоты toolbar").toEqual({width: 360, height: 480})
  })

  test("Toolbar и область дерева", () => {
    const bounds = element.getBoundingClientRect()
    const toolbar = element.querySelector('[data-storybook-part="catalog-search"]')!.getBoundingClientRect()
    const tree = element.querySelector('[role="tree"]')!.getBoundingClientRect()
    expect(toolbar.top, "Toolbar начинается внутри section").toBeGreaterThanOrEqual(bounds.top)
    expect(tree.top, "Дерево начинается ниже toolbar").toBeGreaterThanOrEqual(toolbar.bottom)
    expect(tree.bottom, "Дерево укладывается в нижнюю границу section").toBeLessThanOrEqual(bounds.bottom)
    expect(tree.width, "Дерево не выходит за ширину section").toBeLessThanOrEqual(bounds.width)
    expect(tree.height, "После размещения toolbar дереву остаётся положительная высота").toBeGreaterThan(0)
  })

  test("Исходная ветка", () => {
    expect(element.querySelector('[data-tree-id="group:components"]')!.getAttribute("aria-expanded"),
      "Раскрытие соответствует переданному либо начальному состоянию").toBe(String(expected.expanded))
    expect([...element.querySelectorAll("[data-tree-id]")].map(node => node.getAttribute("data-tree-id")),
      "Показаны ожидаемые строки ветки с учётом поиска и раскрытия").toEqual([...expected.rows])
  })

  test("Доступные действия", () => {
    const toolbar = element.querySelector('[data-storybook-part="catalog-search"]')!
    expect([...toolbar.querySelectorAll("button")].map(node => node.getAttribute("aria-label")),
      "Без переходов и управления Repo доступны только раскрытие и сворачивание").toEqual([
      "Развернуть всё дерево", "Свернуть всё дерево",
    ])
    expect(toolbar.querySelector('input[type="search"]') !== null,
      "Поле поиска показывается по публичному showSearch").toBe(props.showSearch !== false)
  })

  test("Раскрытие и сворачивание", async () => {
    props.navigationExpansion.save.mockClear()
    element.querySelector('[aria-label="Свернуть всё дерево"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    expect(element.querySelector('[data-tree-id="group:components"]')!.getAttribute("aria-expanded"),
      "Команда закрывает ветвь").toBe("false")
    element.querySelector('[aria-label="Развернуть всё дерево"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    expect([...element.querySelectorAll("[data-tree-id]")].map(node => node.getAttribute("data-tree-id")),
      "Раскрытие возвращает строки той же ветки").toEqual([...expected.expandedRows])
    expect(props.navigationExpansion.save.mock.calls,
      "Обе команды сохраняют точные списки закрытых ветвей").toEqual([[["components"]], [[]]])
    expect(props.onAction.mock.calls, "Раскрытие не выполняет управление Repo").toEqual([])
    expect(props.onSearch.mock.calls, "Раскрытие не изменяет поиск").toEqual([])
    if (!expected.expanded) {
      element.querySelector('[aria-label="Свернуть всё дерево"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      await headless.screenshot(element)
    }
  })

  test("Раскрытие отдельной группы", async () => {
    props.onGroupToggle.mockClear()
    const group = element.querySelector('[data-tree-id="group:components"]')!
    group.querySelector("button")!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    group.querySelector("button")!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    expect(props.onGroupToggle.mock.calls.map(([item, collapsed]) => ({id: item.id, collapsed})),
      "Переключение передаёт группу и оба последовательных состояния владельцу").toEqual([
      {id: "components", collapsed: expected.expanded},
      {id: "components", collapsed: !expected.expanded},
    ])
  })

  /** @remarks В закрытой ветви дочерняя строка недоступна до раскрытия. */
  describe.skipIf(!["Ветка", "Поиск по каталогу", "Сохранённое раскрытие важнее начального состояния"].includes(name))("Строка раскрытой ветки", () => {
    test("Клик и Enter", async () => {
      const before = [...element.querySelectorAll("[data-tree-id]")]
      const row = element.querySelector('[data-tree-id="button"]')!
      row.querySelector("[data-tree-row]")!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      row.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
      await headless.screenshot(element)
      expect([...element.querySelectorAll("[data-tree-id]")], "Без обработчика перехода клики сохраняют состав и идентичность строк").toEqual(before)
      expect(props.onAction.mock.calls, "Выбор строки не выполняет управление Repo").toEqual([])
    })
  })

  /** @remarks В вариантах без поля поиска ввод не предлагается пользователю. */
  describe.skipIf(![
    "Поиск по каталогу",
    "Свёрнуто без сохранённого состояния",
    "Сохранённое раскрытие важнее начального состояния",
  ].includes(name))("Поиск", () => {
    test("Изменение запроса", () => {
      props.onSearch.mockClear()
      const field = element.querySelector('input[type="search"]') as HTMLInputElement
      field.value = "Tab"
      field.dispatchEvent(new Event("input", {bubbles: true}))
      expect<readonly unknown[]>(props.onSearch.mock.calls, "Поле передаёт новый запрос и источник ввода владельцу состояния").toEqual([["Tab", field]])
      field.value = props.search
    })
  })
})
