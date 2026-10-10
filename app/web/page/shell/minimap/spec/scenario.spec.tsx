import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {MouseEvent} from "@zavx0z/immersive"
import {flushDocumentLayoutObservers} from "@zavx0z/immersive"
import Minimap from "../index.tsx"

describe.each([
  {name: "Раскрытая карта", props: {initialState: {collapsed: false, geometry: {x: 8, y: 8, width: 300, height: 480}, tab: {edge: "left" as const, offset: .5}}}},
  {name: "Восстановленная свёрнутая карта", props: {initialState: {collapsed: true, geometry: {x: 64, y: 32, width: 340, height: 420}, tab: {edge: "right" as const, offset: .75}}}},
])("$name", async ({props: input}) => {
  const headless = createHeadless({width: 640, height: 560})
  afterAll(() => headless.dispose())
  const rebuild = Promise.withResolvers<void>()
  const props = {
    ...input,
    onRebuildWeb: mock(() => rebuild.promise),
    projectName: "Fixture Project",
    catalog: {
      label: "Каталог",
      search: "",
      items: [
        {id: "project", label: "Проект", route: "/project"},
        {id: "component", label: "Компонент", route: "/project/component", parentId: "project"},
      ],
      activeId: "component",
      management: null,
      onNavigate: mock(),
      onAction: mock(),
      onSearch: mock(),
      onGroupToggle: mock(),
    },
  }
  const element = await headless.render(
    <Minimap
      projectName={props.projectName}
      catalog={props.catalog}
      initialState={props.initialState}
      onRebuildWeb={props.onRebuildWeb}
    />,
  )
  const panel = element.querySelector("[data-window]")!
  const tab = element.querySelector("[data-minimap-tab]")!

  test("Имя Project", () => {
    expect(panel.querySelector("[data-window-title]")!.textContent,
      "Заголовок окна использует переданное имя Project").toBe(props.projectName)
    expect(tab.querySelector('button[aria-label="Fixture Project"]'),
      "Свернутую карту открывает кнопка с тем же именем Project").not.toBeNull()
  })

  test("Начальное раскрытие дерева", () => {
    expect(panel.querySelector('[data-tree-id="project"]')!.getAttribute("aria-expanded"),
      "При отсутствии сохранённого состояния Minimap начинает со свёрнутого дерева").toBe("false")
    expect(panel.querySelector('[data-tree-id="component"]'),
      "Дочерняя строка появляется после раскрытия ветви").toBeNull()
  })

  test("Начальная видимость", () => {
    expect(panel.hasAttribute("hidden"), "Раскрытое состояние показывает панель каталога").toBe(input.initialState.collapsed)
    expect(tab.hasAttribute("hidden"), "Свёрнутое состояние показывает Tab").toBe(!input.initialState.collapsed)
  })

  test("Восстановление Tab", () => {
    expect(tab.querySelector("[data-tab]")!.getAttribute("data-edge"), "Tab получает сохранённую сторону при создании Minimap").toBe(input.initialState.tab.edge)
  })

  test("Скрытие и восстановление дерева", async () => {
    if (panel.hasAttribute("hidden")) element.querySelector('button[aria-label="Fixture Project"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    const tree = panel.querySelector('[role="tree"]')!
    element.querySelector('[aria-label="Свернуть всё дерево"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    const group = tree.querySelector('[role="treeitem"]')!
    element.querySelector('[aria-label="Скрыть Fixture Project"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    flushDocumentLayoutObservers(element.ownerDocument!)
    await headless.screenshot(element)
    expect(panel.hasAttribute("hidden"), "Кнопка скрывает панель").toBeTrue()
    expect(tab.hasAttribute("hidden"), "Вместо панели доступен Tab").toBeFalse()
    expect(tab.querySelector('[data-tab]')!.getAttribute("data-ready"), "Tab получает размеры HUD после скрытия панели").toBe("true")
    if (panel.hasAttribute("hidden")) element.querySelector('button[aria-label="Fixture Project"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    expect(panel.hasAttribute("hidden"), "Кнопка таба возвращает панель").toBeFalse()
    expect(panel.querySelector('[role="tree"]') === tree, "Скрытие сохраняет экземпляр дерева").toBeTrue()
    expect(group.getAttribute("aria-expanded"), "Свёрнутая ветвь остаётся свёрнутой после открытия").toBe("false")
    element.querySelector('[aria-label="Развернуть всё дерево"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
  })

  test("Переход по каталогу", async () => {
    if (panel.hasAttribute("hidden")) element.querySelector('button[aria-label="Fixture Project"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    const row = panel.querySelector('[data-tree-id="component"] [data-tree-row]')!
    row.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    expect(props.catalog.onNavigate.mock.calls, "Переход передаёт исходный элемент каталога и источник события владельцу навигации").toEqual([
      [props.catalog.items[1], row],
    ])
  })

  test("Явная пересборка интерфейса", async () => {
    if (panel.hasAttribute("hidden")) element.querySelector('button[aria-label="Fixture Project"]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    const button = panel.querySelector('button[aria-label="Пересобрать интерфейс"]')!
    expect(panel.querySelector('[data-storybook-part="catalog-search"]')!.contains(button), "Пересборка расположена в одной строке с поиском и действиями дерева").toBeTrue()
    expect(button.querySelector("img"), "Действие представлено значком").not.toBeNull()
    expect(button.textContent, "Значок не занимает место текстовой подписью").toBe("")
    try {
      button.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      button.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      await headless.screenshot(element)
      expect(props.onRebuildWeb.mock.calls, "Два нажатия до завершения создают одну попытку пересборки Web").toEqual([[]])
      expect(button.hasAttribute("disabled"), "Кнопка блокируется во время подготовки").toBeTrue()
      expect(button.getAttribute("title"), "Подсказка кнопки раскрывает ожидание").toBe("Пересборка интерфейса…")
    } finally {
      rebuild.resolve()
      await rebuild.promise
      await headless.screenshot(element)
    }
    expect(button.hasAttribute("disabled"), "После завершения доступна следующая явная пересборка").toBeFalse()
    expect(button.getAttribute("title"), "После подготовки подсказка возвращает название действия").toBe("Пересобрать интерфейс")
  })
})
