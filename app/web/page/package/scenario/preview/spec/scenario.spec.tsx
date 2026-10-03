/** Preview оставляет место фикстуре в общем Display и переносит её по placement. */
import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import createScenarioApp from "@scenario/model"
import ScenarioPreview from "@scenario/preview"

describe.each([
  {name: "Начальная позиция", props: {placement: {x: 0, y: 0}}},
  {name: "Сдвинутая сцена", props: {placement: {x: 24, y: 36}}},
])("$name", async ({props}) => {
  const app = createScenarioApp({
    kind: "function",
    variants: [{id: "first", title: "Пример", source: "await readExample()", points: [], calls: []}],
  })
  const headless = createHeadless({width: 320, height: 240})
  afterAll(() => { app.dispose(); headless.dispose() })
  const element = await headless.render(
    <ScenarioPreview
      app={app}
      placement={props.placement}
    />,
  )
  const stage = element.querySelector("[data-scenario-stage]")!

  test("Общая сцена", () => {
    expect(element.querySelectorAll("[data-scenario-stage]").length,
      "Внутри preview существует одно место для подготовленной host фикстуры"
    ).toBe(1)
    expect(stage.getAttribute("data-hidden"), "Выбранный вариант без запуска показывает сцену").toBe("false")
  })
  test("Положение", () => {
    expect(stage.getAttribute("style"), "Placement задаёт смещение сцены в CSS custom properties").toContain(`--scenario-x: ${props.placement.x}px`)
  })
})
