import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Command} from "@fixture/scenario-component"

describe.each([
  {name: "Подпись из списка", props: {labels: ["Первый", "Второй"]}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const node = await headless.render(
    <Command
      label={props.labels.join(", ")}
      disabled={false}
    />,
  )
  test("Подпись", () => {
    expect(node.textContent, "Обязательные данные сценария преобразуются в props публичного компонента").toBe("Первый, Второй")
  })
})
