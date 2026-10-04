import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Badge} from "../../component"
import {SlotPanel} from "../index"

describe.each([
  {
    name: "Два слота",
    props: {label: "Панель"},
    slots: {
      header: <Badge slot="header" label="Заголовок" />,
      default: <Badge label="Содержимое" />,
    },
    expected: {header: "Заголовок", body: "Содержимое"},
  },
  {
    name: "Пустые слоты",
    props: {label: "Пустая панель"},
    expected: {header: "", body: ""},
  },
  {
    name: "Только именованный слот",
    props: {label: "Только заголовок"},
    slots: {header: <Badge slot="header" label="Заголовок" />},
    expected: {header: "Заголовок", body: ""},
  },
])("$name", async ({props, slots = {}, expected}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const result = await headless.render(
    <SlotPanel label={props.label}>
      {slots.header}
      {slots.default}
    </SlotPanel>,
  )

  test("Свойства", () => {
    expect(result.getAttribute("aria-label"), "Props передают собственные свойства панели").toBe(props.label)
  })
  test("Слоты", () => {
    expect({header: result.querySelector("[data-heading]")!.textContent, body: result.querySelector("[data-body]")!.textContent},
      "Именованный слот получает компонент с slot=header, безымянный — обычный JSX; отсутствующее значение оставляет соответствующую область пустой",
    ).toEqual(expected)
  })
})
