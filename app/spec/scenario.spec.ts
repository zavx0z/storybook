/**
Явная подготовка и применение Web через контейнер приложения.
Порты примера наблюдают публикацию, не запускают сервер или компилятор.

@packageDocumentation
*/
import {afterAll, describe, expect, mock, test} from "bun:test"
import createApp from "@storybook/app"
import type {Contract} from "@storybook/app"

const version = {platform: "platform-a", web: "web-b"} as const

describe.each([
  {
    name: "Подготовка кандидата",
    apply: false,
    props: {
      web: {
        prepare: mock(async (_signal: AbortSignal) => version),
        versions: (candidate: typeof version) => [candidate],
        publish: mock((_candidate: typeof version) => {}),
      },
    } satisfies Contract.Input<typeof version>,
  },
  {
    name: "Применение интерфейса",
    apply: true,
    props: {
      web: {
        prepare: mock(async (_signal: AbortSignal) => version),
        versions: (candidate: typeof version) => [candidate],
        publish: mock((_candidate: typeof version) => {}),
      },
    } satisfies Contract.Input<typeof version>,
  },
])("$name", async ({props, apply}) => {
  const app = createApp(props)
  afterAll(() => app.dispose())
  const initial = app.status()
  const initialPreparations = props.web.prepare.mock.calls.length
  const result = await app.rebuildWeb({apply})

  test("Создание приложения", () => {
    expect(initial.web.phase, "Создание подключает готовые порты без запуска подготовки").toBe("idle")
    expect(initialPreparations, "Создание приложения не обращается к сборщику").toBe(0)
    expect(props.web.prepare.mock.calls, "Подготовка выполняется только после явного rebuildWeb").toHaveLength(1)
  })

  test("Версия интерфейса", () => {
    expect(result.versions, "Кандидат Web подготовлен для сохранённой платформы").toEqual([version])
    expect(app.status().web, "Контейнер раскрывает состояние принадлежащей ему операции Web").toBe(result)
  })

  test("Завершение операции", () => {
    expect(result.phase, "Явное применение публикует подготовленный кандидат, подготовка оставляет его доступным для проверки")
      .toBe(apply ? "published" : "prepared")
    expect(props.web.publish.mock.calls, "Порт публикации получает кандидат только при явном применении")
      .toEqual(apply ? [[version]] : [])
  })
})
