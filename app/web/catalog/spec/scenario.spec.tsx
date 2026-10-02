import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import CatalogPanel from "../index"

describe.each([
  {name: "Каталог", props: {search: "", initialCollapsedIds: []}},
  {name: "Поиск", props: {search: "Кнопка", initialCollapsedIds: []}},
  {name: "Свёрнутая ветвь", props: {search: "", initialCollapsedIds: ["components"]}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 360, height: 480})
  afterAll(() => headless.dispose())
  const items = [
    {id: "button", label: "Кнопка", route: "/button", group: {id: "components", label: "Компоненты"}},
    {id: "tab", label: "Tab", route: "/tab", group: {id: "components", label: "Компоненты"}},
  ]
  const element = await headless.render(
    <CatalogPanel
      label="Каталог"
      search={props.search}
      items={items}
      activeId="button"
      management={null}
      navigationExpansion={{initialCollapsedIds: props.initialCollapsedIds, save: mock()}}
      onAction={mock()}
      onNavigate={mock()}
      onSearch={mock()}
      onGroupToggle={mock()}
    />,
  )

  test("Дерево", () => {
    expect(element.querySelector('[role="tree"]') !== null, "Панель использует общее дерево UI").toBeTrue()
    expect(element.querySelector('[data-tree-id="group:components"]')!.getAttribute("aria-expanded"), "Раскрытие восстанавливается из переданного состояния").toBe(props.initialCollapsedIds.length === 0 ? "true" : "false")
  })

  test("Фильтр", () => {
    const labels = [...element.querySelectorAll('[data-tree-id]')].map(node => node.getAttribute("data-tree-id"))
    expect(labels.includes("button"), "Кнопка видна в раскрытой ветви и соответствует поиску").toBe(props.initialCollapsedIds.length === 0)
    expect(labels.includes("tab"), "Поисковый запрос оставляет только соответствующие строки").toBe(props.search === "" && props.initialCollapsedIds.length === 0)
  })

  test("Принимающая поверхность", () => {
    expect(element.querySelector('[aria-label="Скрыть Minimap"]'), "В Display действие скрытия отсутствует без callback").toBeNull()
  })
})
