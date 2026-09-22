import {describe, expect, test} from "bun:test"
import {createScenarioApp} from "@storybook/app"
import type {ScenarioAppInput} from "@storybook/app/contract/input"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {StatefulFixture} from "./fixture"

describe.each([
  {
    name: "Компонент",
    props: {
      kind: "component",
      template: StatefulFixture as unknown as CompiledTemplate<Record<string, unknown>>,
      variants: [
        {
          id: "first",
          title: "Первый",
          props: {name: "Первый"},
          source: '<StatefulFixture name="Первый" />',
          points: [{title: "Имя компонента"}],
        },
        {
          id: "second",
          title: "Второй",
          props: {name: "Второй"},
          source: '<StatefulFixture name="Второй" />',
          points: [{title: "Изменённое имя"}],
        },
      ],
    },
  },
  {
    name: "Результат функции",
    props: {
      kind: "function",
      variants: [
        {
          id: "first",
          title: "Корневой пакет",
          source: 'await readPackage({path: "root"})',
          points: [{title: "Данные пакета", content: "Содержимое package.json"}],
          calls: [{
            id: 1,
            source: 'await readPackage({path: "root"})',
            outcome: {type: "resolve", value: {name: "root", empty: []}},
          }],
        },
        {
          id: "second",
          title: "Вложенный пакет",
          source: 'await readPackage({path: "nested"})',
          points: [{title: "Данные пакета"}],
          calls: [{
            id: 2,
            source: 'await readPackage({path: "nested"})',
            outcome: {type: "resolve", value: {name: "nested", enabled: false}},
          }],
        },
      ],
    },
  },
  {
    name: "Сохранённая ошибка функции",
    props: {
      kind: "function",
      variants: [
        {
          id: "first",
          title: "Пустой результат",
          source: "await readItems()",
          points: [],
          calls: [{id: 1, source: "await readItems()", outcome: {type: "resolve", value: []}}],
        },
        {
          id: "second",
          title: "Ошибка чтения",
          source: 'await readPackage({path: "missing"})',
          points: [{title: "Причина ошибки"}],
          calls: [{
            id: 2,
            source: 'await readPackage({path: "missing"})',
            outcome: {type: "reject", error: {message: "Файл отсутствует"}},
          }],
        },
      ],
    },
  },
] satisfies {name: string, props: ScenarioAppInput}[])("$name", ({props}) => {
  const originalVariants = structuredClone(props.variants)
  const app = createScenarioApp(props)
  const initial = app.getSnapshot()
  const notifications: string[] = []
  const unsubscribe = app.subscribe(() => notifications.push(app.getSnapshot().id))
  let selected: ReturnType<typeof app.getSnapshot>
  let repeated: ReturnType<typeof app.getSnapshot>
  let changes: string[]
  try {
    app.select("second")
    selected = app.getSnapshot()
    app.select("second")
    repeated = app.getSnapshot()
    changes = [...notifications]
  } finally {
    unsubscribe()
  }
  app.select("first")
  const restored = app.getSnapshot()

  test("Состав App", () => {
    expect(app, "Представление предоставляет вид сценария, варианты, снимок, выбор и подписку").toEqual({
      kind: props.kind,
      variants: originalVariants,
      getSnapshot: expect.any(Function),
      select: expect.any(Function),
      subscribe: expect.any(Function),
      dispose: expect.any(Function),
    })
  })

  describe("Выбор варианта", () => {
    test("Начальный снимок", () => {
      expect(initial, "Первый вариант открыт сразу со всеми исходными данными").toEqual(originalVariants[0]!)
    })
    test("Другой вариант", () => {
      expect(selected, "Выбор меняет весь снимок: декларацию, пункты и данные компонента или функции").toEqual(originalVariants[1]!)
    })
    test("Повторный выбор", () => {
      expect(repeated, "Повторный выбор сохраняет объект текущего снимка").toBe(selected)
    })
    test("Возврат", () => {
      expect(restored, "Возврат открывает тот же исходный снимок первого варианта").toBe(initial)
    })
    test("Исходные данные", () => {
      expect(props.variants, "Переключение сохраняет полные данные всех подготовленных вариантов").toEqual(originalVariants)
    })
  })

  describe("Подписка", () => {
    test("Уведомление", () => {
      expect(changes, "Подписчик видит новый снимок один раз; повторный выбор не уведомляет").toEqual(["second"])
    })
    test("Отписка", () => {
      expect(notifications, "После отписки возврат к первому варианту не вызывает подписчика").toEqual(["second"])
    })
  })
})
