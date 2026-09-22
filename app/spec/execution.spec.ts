import {expect, test} from "bun:test"
import {createScenarioApp} from "@storybook/app"
import type {ScenarioAppInput} from "@storybook/app/contract/input"

type Result = Awaited<ReturnType<NonNullable<Extract<ScenarioAppInput, {kind: "function"}>["run"]>>>

test("Переключение запускает тест заново и отклоняет поздний ответ", async () => {
  const pending: {id: string, props: unknown, signal: AbortSignal, resolve: (result: Result) => void,
    progress: Parameters<NonNullable<Extract<ScenarioAppInput, {kind: "function"}>["run"]>>[2]}[] = []
  const app = createScenarioApp({
    kind: "function",
    variants: ["a", "b"].map(id => ({id, title: id, props: {path: id}, source: id, points: [],
      calls: [{id: 99, source: id, outcome: {type: "return", value: "cached"}}]})),
    run: (variant, signal, progress) => new Promise(resolve => pending.push({id: variant.id, props: variant.props, signal, resolve, progress})),
  })
  const completed = (value: string): Result => ({source: value, points: [],
    calls: [{id: 0, source: value, outcome: {type: "return", value}}], execution: {status: "passed", tests: []}})
  try {
    await Promise.resolve()
    expect(app.getSnapshot()).toMatchObject({id: "a", calls: [], execution: {status: "running"}})
    pending[0]!.progress({phase: "running", text: "a: проверка\n"})
    expect(app.getSnapshot().execution?.progress?.output).toBe("a: проверка\n")
    app.select("b")
    await Promise.resolve()
    expect(pending[0]!.signal.aborted).toBeTrue()
    pending[0]!.progress({phase: "running", text: "старый вывод"})
    expect(app.getSnapshot().execution?.progress).toBeUndefined()
    pending[1]!.resolve(completed("fresh-b"))
    await Bun.sleep(0)
    pending[0]!.resolve(completed("late-a"))
    await Bun.sleep(0)
    expect(app.getSnapshot()).toMatchObject({id: "b", source: "fresh-b", execution: {status: "passed"}})
    app.select("a")
    await Promise.resolve()
    expect(pending.map(({id, props}) => ({id, props}))).toEqual([
      {id: "a", props: {path: "a"}}, {id: "b", props: {path: "b"}}, {id: "a", props: {path: "a"}},
    ])
    expect(app.getSnapshot()).toMatchObject({calls: [], execution: {status: "running"}})
  } finally {
    app.dispose()
  }
  expect(pending[2]!.signal.aborted).toBeTrue()
})

test("Ошибка запуска заменяет сохранённый результат", async () => {
  const app = createScenarioApp({kind: "function", variants: [{id: "a", title: "a", source: "call()", points: [], calls: []}],
    run: async () => { throw new Error("Тест не запущен") }})
  try {
    await Bun.sleep(0)
    expect(app.getSnapshot()).toMatchObject({calls: [], execution: {status: "failed", message: "Тест не запущен"}})
  } finally {
    app.dispose()
  }
})
