/** Result показывает исход выбранного варианта на общем Experience. */
import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import createScenarioApp from "@zavx0z/storybook-app-web-page-package-scenario-model"
import StorybookAppWebPagePackageScenarioResult from "@zavx0z/storybook-app-web-page-package-scenario-result"

describe.each([
  {name: "Нет выполненных вызовов", props: {source: "await readItems()", title: "Пустой список"}},
  {name: "Другой исходный пример", props: {source: "await readPackage()", title: "Пакет"}},
])("$name", async ({props}) => {
  const app = createScenarioApp({
    kind: "function",
    variants: [{id: "first", title: props.title, source: props.source, points: [], calls: []}],
  })
  const headless = createHeadless({width: 320, height: 240})
  afterAll(() => { app.dispose(); headless.dispose() })
  const element = await headless.render(
    <StorybookAppWebPagePackageScenarioResult
      app={app}
    />,
  )

  test("Отсутствие вызовов", () => {
    expect(element.textContent, "До исполнения сценарий явно сообщает, что вызовов пока нет").toContain("В этом варианте нет выполненных вызовов")
  })
  test("Единый результат", () => {
    expect(element.getAttribute("data-scenario-result"),
      "Один выбранный вариант получает одно представление результата"
    ).toBe("")
  })
})
