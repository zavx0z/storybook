/** Preview центрирует авторский размер штатным CSS в общем Display. */
import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import createScenarioApp from "@scenario/model"
import ScenarioPreview from "@scenario/preview"

describe.each([
  {name: "Компактный пример", props: {width: 180, height: 38}},
  {name: "Пример на всю ширину", props: {width: 320, height: 120}},
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
    />,
  )
  const stage = element.querySelector("[data-scenario-stage]")!
  const fixture = element.ownerDocument!.createElement("div")
  fixture.setAttribute("style", `width:${props.width}px;height:${props.height}px`)
  stage.append(fixture)

  test("Общая сцена", () => {
    expect(element.querySelectorAll("[data-scenario-stage]").length,
      "Preview предоставляет одно место для проверенной host фикстуры").toBe(1)
    expect(stage.getAttribute("data-hidden"), "Вариант без запуска показывает сцену").toBe("false")
  })
  test("Центр и авторский размер", async () => {
    await headless.capture(element)
    const viewport = element.getBoundingClientRect()
    const bounds = fixture.getBoundingClientRect()
    expect(bounds.width, "Preview не уменьшает ширину компонента").toBe(props.width)
    expect(bounds.height, "Preview не уменьшает высоту компонента").toBe(props.height)
    expect(bounds.x - viewport.x, "CSS центрирует компонент по горизонтали").toBe((viewport.width - props.width) / 2)
    expect(bounds.y - viewport.y, "CSS центрирует компонент по вертикали").toBe((viewport.height - props.height) / 2)
  })
})
