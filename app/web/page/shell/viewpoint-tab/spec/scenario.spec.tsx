import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import type {HTMLButtonElement} from "@immersive/dom"
import ViewPointTab from "../index"

describe.each([
  {name: "Ожидание ViewPoint", props: {ready: false, frozen: true}},
  {name: "Замороженные жесты", props: {ready: true, frozen: true}},
  {name: "Свободное управление", props: {ready: true, frozen: false}},
])("$name", async ({props: input}) => {
  const headless = createHeadless({width: 640, height: 240})
  afterAll(() => headless.dispose())
  const props = {
    controls: {
      initialPosition: {edge: "top" as const, offset: .5},
      getSnapshot: () => input,
      subscribe: () => () => {},
      savePosition: mock(),
      restoreCamera: mock(),
      bind: mock(),
      toggleFrozen: mock(),
      zoom: mock<(factor: number) => void>(),
      fit: mock(),
      dispose: mock(),
    },
  }
  const element = await headless.render(
    <ViewPointTab
      controls={props.controls}
    />,
  )
  const buttons = [...element.querySelectorAll('[role="toolbar"] button')] as HTMLButtonElement[]

  test("Команды", () => {
    expect(buttons.map(button => ({label: button.getAttribute("aria-label"), disabled: button.hasAttribute("disabled")})),
      "Tab показывает приближение, отдаление, режим жестов и вписывание; доступность задаётся состоянием контроллера").toEqual([
      {label: "Отдалить ViewPoint", disabled: !input.ready},
      {label: "Приблизить ViewPoint", disabled: !input.ready},
      {label: input.frozen ? "Разморозить ViewPoint" : "Заморозить ViewPoint", disabled: !input.ready},
      {label: "Вписать в область просмотра", disabled: !input.ready},
    ])
  })

  test("Действия", () => {
    for (const button of buttons) button.click()
    expect(props.controls.zoom.mock.calls, "Кнопки передают контроллеру множители расстояния").toEqual(input.ready ? [[1.2], [1 / 1.2]] : [])
    expect(props.controls.toggleFrozen.mock.calls, "Кнопка переключения жестов передаёт событие своему обработчику").toEqual(input.ready ? [[expect.objectContaining({type: "click"})]] : [])
    expect(props.controls.fit.mock.calls, "Кнопка вписывания передаёт событие своему обработчику").toEqual(input.ready ? [[expect.objectContaining({type: "click"})]] : [])
  })
})
