import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {MouseEvent} from "@zavx0z/immersive-dom"
import Minimap from "../index.tsx"

describe.each([
  {name: "Ошибка подготовки интерфейса", error: new Error("Не удалось подготовить Web"), message: "Не удалось подготовить Web"},
  {name: "Текстовый отказ приложения", error: "Среда несовместима", message: "Среда несовместима"},
])("$name", async ({error, message}) => {
  const headless = createHeadless({width: 640, height: 560})
  afterAll(() => headless.dispose())
  let attempt = 0
  const props = {
    onRebuildWeb: mock(async () => {
      attempt += 1
      if (attempt === 1) throw error
    }),
    projectName: "Fixture Project",
    catalog: {
      label: "Каталог",
      search: "",
      items: [],
      activeId: null,
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
      onRebuildWeb={props.onRebuildWeb}
    />,
  )

  test("Отказ виден и допускает новую попытку", async () => {
    const button = element.querySelector('button[aria-label="Пересобрать интерфейс"]')!
    button.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    const alert = element.querySelector('[role="alert"]')!
    expect(alert.hasAttribute("hidden"), "Отказ приложения показывается в Minimap").toBeFalse()
    expect(alert.textContent, "Пользователь получает причину отказа").toBe(message)
    expect(button.hasAttribute("disabled"), "Отказ не оставляет кнопку заблокированной").toBeFalse()

    button.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await headless.screenshot(element)
    expect(props.onRebuildWeb.mock.calls, "Следующее явное нажатие повторяет операцию приложения").toEqual([[], []])
    expect(alert.hasAttribute("hidden"), "Успешная новая попытка убирает предыдущую ошибку").toBeTrue()
  })
})
