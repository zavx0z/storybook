/** Проверяет статическое извлечение fixture и соединение с фактическими вариантами. @packageDocumentation */
import {beforeAll, describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, supportsScenarioPreview, type ReadScenarioOutput} from "@archetypes/specs/scenarios"

const path = resolve(import.meta.dir, "../spec/fixture/component/spec/scenario.spec.tsx")
let result: ReadScenarioOutput
let nonportable: ReadScenarioOutput

beforeAll(async () => {
  [result, nonportable] = await Promise.all([
    readScenario({path}),
    readScenario({path: resolve(import.meta.dir, "../spec/fixture/component/spec/nonportable.test.tsx")}),
  ])
}, 30_000)

test("статический probe распознаёт общую fixture без исполнения сценария", async () => {
  expect(await supportsScenarioPreview({path})).toBeTrue()
})

test("preview сохраняет модуль и фактические варианты", () => {
  expect(result.preview).toMatchObject({
    module: {
      path: resolve(import.meta.dir, "../spec/fixture/component/spec/fixture/index.tsx"),
      export: "CommandFixture",
    },
    variants: [
      {
        id: "0",
        title: "Доступная команда",
        props: {label: "Продолжить", disabled: false},
        points: [
          {title: "Состав представления", content: "Кнопка с подписью и состоянием доступности"},
          {title: "Использование / Подпись", content: "Название действия, переданное в компонент"},
          {title: "Использование / Доступность", content: "Доступность действия в выбранном варианте"},
          {title: "Использование / Тип действия", content: "Команда без неявной отправки формы"},
        ],
      },
      {
        id: "2",
        title: "Недоступная команда",
        props: {label: "Продолжить", disabled: true},
      },
    ],
  })
})

describe.each([
  {name: "доступного", disabled: false},
  {name: "недоступного", disabled: true},
])("JSX $name варианта", ({disabled}) => {
  test("содержит import компонента и конкретные props", () => {
    const source = result.preview?.variants.find(variant => variant.props.disabled === disabled)?.source
    expect(source).toBe(`import {Command} from "@fixture/scenario-component"

<Command
    label={"Продолжить"}
    disabled={${disabled}}
  />`)
  })
})

test("исходники всех вариантов остаются синтаксически корректным TSX", () => {
  const transpiler = new Bun.Transpiler({loader: "tsx"})
  expect(result.preview?.variants.map(variant => {
    transpiler.transformSync(variant.source)
    return variant.title
  })).toEqual(["Доступная команда", "Недоступная команда"])
})

test("обычный сценарий функции не получает выдуманный preview", async () => {
  const functionPath = resolve(import.meta.dir, "../spec/fixture/function/spec/scenario.spec.ts")
  expect(await supportsScenarioPreview({path: functionPath})).toBeFalse()
})

test("непереносимые props оставляют поддержанную fixture без preview", async () => {
  expect({
    supported: await supportsScenarioPreview({path: nonportable.path}),
    preview: nonportable.preview,
  }).toEqual({supported: true, preview: undefined})
})
