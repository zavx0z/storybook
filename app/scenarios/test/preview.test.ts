/** Проверяет статическое извлечение fixture и соединение с фактическими вариантами. @packageDocumentation */
import {beforeAll, describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, supportsScenarioPreview, type ReadScenarioOutput} from "@storybook/app/scenarios"

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
    if (result.preview?.kind !== "component") throw new Error("Нет представления компонента")
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

test("сценарий функции получает снимки вызовов без компонентной fixture", async () => {
  const functionPath = resolve(import.meta.dir, "../spec/fixture/function/spec/scenario.spec.ts")
  expect(await supportsScenarioPreview({path: functionPath})).toBeTrue()
  expect((await readScenario({path: functionPath})).preview).toMatchObject({kind: "function"})
})

test("непереносимые props оставляют поддержанную fixture без preview", async () => {
  expect({
    supported: await supportsScenarioPreview({path: nonportable.path}),
    preview: nonportable.preview,
  }).toEqual({supported: true, preview: undefined})
})

test("отсутствующее необязательное поле не скрывает рабочий вариант", async () => {
  const value = await readScenario({path: resolve(import.meta.dir, "../spec/fixture/component/spec/optional.test.tsx")})
  expect(value.exitCode).toBe(0)
  expect(value.preview?.kind).toBe("component")
  expect(value.preview?.variants[0]?.props).toEqual({label: "Подпись"})
  expect(value.preview?.variants[0]?.source).toContain("{undefined}")
})

test("пример со состоянием показывает настоящий компонент, подготовку и обработчики", async () => {
  const path = resolve(import.meta.dir, "../spec/fixture/component/spec/stateful.test.tsx")
  expect(await supportsScenarioPreview({path})).toBeTrue()
  const value = await readScenario({path})
  expect(value.exitCode).toBe(0)
  expect(value.preview?.kind).toBe("component")
  const variant = value.preview?.variants[0]!
  const fixture = await Bun.file(resolve(import.meta.dir, "../spec/fixture/component/spec/fixture/stateful.tsx")).text()
  expect(variant.source).toContain(fixture.trim())
  expect(variant.source).toContain('<StatefulFixture\n')
  expect(variant.source).toContain('"label": "Продолжить"')
  expect(variant.props).toEqual({label: "Продолжить", disabled: false})
  new Bun.Transpiler({loader: "tsx"}).transformSync(variant.source)
}, 30_000)

test("парные теги сохраняют JSX children и выбранный запуск без сериализации шаблона", async () => {
  const path = resolve(import.meta.dir, "../spec/fixture/component/spec/children.test.tsx")
  expect(await supportsScenarioPreview({path})).toBeTrue()
  const result = await readScenario({path})
  expect(result.exitCode).toBe(0)
  expect(result.preview?.kind).toBe("component")
  if (result.preview?.kind !== "component") throw new Error("Нет preview")
  expect(result.preview.variants.map(item => item.title)).toEqual(["label", "children"])
  const child = result.preview.variants[1]!
  expect(child.props).toEqual({label: null})
  expect(child.jsxProps?.children?.source).toBe('<Content label="Дочерний компонент" />')
  expect(child.source).toContain('import {Badge as Content} from "@fixture/scenario-component"')
  expect(child.source).toContain('<Container label={null}>')
  expect(child.source).toContain('    <Content label="Дочерний компонент" />')
  expect(child.source).not.toContain("{<")
  expect(child.points[0]?.title).toBe("Контент / Передача")
  const selected = await readScenario({path, variant: 1, props: child.props})
  expect(selected.exitCode).toBe(0)
  expect(selected.preview?.variants).toHaveLength(1)
  expect(selected.preview?.variants[0]?.source).toBe(child.source)
}, 30_000)

test("вложенные describe.each сохраняют дерево, JSX родителя и точный путь запуска", async () => {
  const path = resolve(import.meta.dir, "../spec/fixture/component/spec/nested.test.tsx")
  expect(await supportsScenarioPreview({path})).toBeTrue()
  const result = await readScenario({path})
  expect(result.exitCode).toBe(0)
  if (result.preview?.kind !== "component") throw new Error("Нет preview")
  expect(result.preview.variants.map(item => item.title)).toEqual([
    "label / Слева", "label / Справа", "children / Слева", "children / Справа",
  ])
  expect(result.preview.variants.map(item => item.selection)).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]])
  const child = result.preview.variants[3]!
  expect(child.path).toEqual(["children", "Справа"])
  expect(child.props).toEqual({label: null, side: "right"})
  expect(child.source).toContain('<Content label="Дочерний компонент" />')
  const selected = await readScenario({path, variantPath: [1, 1], props: child.props})
  expect(selected.exitCode).toBe(0)
  expect(selected.groups.map(group => group.label)).toEqual(["children", "Справа"])
  expect(selected.tests).toHaveLength(1)
  expect(selected.calls.filter(call => call.name.endsWith(".render"))).toHaveLength(1)
  expect(selected.preview?.variants[0]?.source).toBe(child.source)
  expect(selected.preview?.variants[0]).toMatchObject({selection: [1, 1], path: ["children", "Справа"]})
}, 30_000)
