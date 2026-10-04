/** Inspector показывает исходную декларацию выбранного варианта. */
import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import createScenarioApp from "@zavx0z/storybook-app-web-page-package-scenario-model"
import Zavx0zStorybookAppWebPagePackageScenarioInspector from "@zavx0z/storybook-app-web-page-package-scenario-inspector"

describe.each([
  {name: "Первый пример", props: {source: "await readPackage({path: 'root'})", title: "Корень"}},
  {name: "Второй пример", props: {source: "await readPackage({path: 'child'})", title: "Потомок"}},
])("$name", async ({props}) => {
  const app = createScenarioApp({
    kind: "function",
    variants: [{id: "first", title: props.title, source: props.source, points: [], calls: []}],
  })
  const headless = createHeadless({width: 500, height: 360})
  afterAll(() => { app.dispose(); headless.dispose() })
  const element = await headless.render(
    <Zavx0zStorybookAppWebPagePackageScenarioInspector
      value={app}
    />,
  )

  test("Выбранный вариант", () => {
    expect(element.textContent, "Дерево инспектора содержит название выбранного авторского примера").toContain(props.title)
  })
  test("Области инспектора", () => {
    expect(element.querySelector("[data-scenario-variants]"),
      "После редактора исходника доступно дерево вариантов и пунктов"
    ).not.toBeNull()
  })
})
