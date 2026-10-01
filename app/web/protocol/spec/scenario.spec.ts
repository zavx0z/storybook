/** Один Web-протокол задаёт адрес пакета и заголовок выбранной страницы. */
import {describe, expect, test} from "bun:test"
import WebProtocol from "@app-web/protocol"

describe.each([
  {name: "Корневая страница", props: {packageId: null, label: undefined, title: "Storybook"}},
  {name: "Страница пакета", props: {packageId: "@fixture/engine", label: "Engine", title: "Engine"}},
])("$name", ({props}) => {
  const title = WebProtocol.pageTitle(props.packageId, props.label)

  test("Заголовок", () => {
    expect(title, "Browser title соответствует выбранной странице и её точной метке").toBe(props.title)
  })

  describe.skipIf(props.packageId === null)("Путь пакета", () => {
    test("Обратимое кодирование", () => {
      const encoded = WebProtocol.encodePackagePath(props.packageId!)
      expect(WebProtocol.decodePackagePath(encoded, [props.packageId!]),
        "Идентичность пакета занимает один сегмент URL и восстанавливается по каталогу"
      ).toBe(props.packageId!)
    })
  })
})
