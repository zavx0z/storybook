import {describe, expect, test} from "bun:test"
import loader from "@storybook-package-build/loader"

describe.each([
  {name: "Первая ревизия", props: {revision: "revision-a"}},
  {name: "Следующая ревизия", props: {revision: "revision-b"}},
])("$name", ({props}) => {
  const revisionUrl = `/__storybook/revisions/%40fixture%2Fbutton/${props.revision}/`
  const source = loader.generateLoaderSource({revisionUrl, scenarios: [{
    nodeId: "directory:package:@fixture/button/controls",
    kind: "component",
    module: {path: "/owner/controls/index.tsx", export: "default"},
    variants: [{id: "default", title: "Default", props: {label: "Button"}, source: "<Button />", points: []}],
  }]})

  test("Импорт компонента", () => {
    expect(source, "Lazy loader импортирует точный публичный модуль указанного компонента")
      .toContain('import("/owner/controls/index.tsx")')
  })

  test("Адрес ревизии", () => {
    expect(source, "Источник привязан к immutable URL выбранной пакетной ревизии")
      .toContain(revisionUrl)
  })
})
