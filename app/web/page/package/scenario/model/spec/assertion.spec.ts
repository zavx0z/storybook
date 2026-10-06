import {expect, test} from "bun:test"
import createApp from "@zavx0z/storybook-app-web-page-package-scenario-model"

test("выбор expect показывает его actual и не запускает сценарий; заголовок возвращает общий результат", () => {
  const value = {text: "Исходный документ"}
  const variants = ["a", "b"].map(id => ({id, title: id, source: "read()", calls: [], points: [{title: "Документ", assertions: [
    {id: `${id}-text`, label: "Содержимое", value},
    {id: `${id}-empty`, label: "Пустая строка", value: ""},
    {id: `${id}-false`, label: "Выключено", value: false},
    {id: `${id}-null`, label: "Нет значения", value: null},
  ]}]}))
  const app = createApp({kind: "function", variants})
  try {
    app.selectAssertion("a-text")
    expect(app.getSnapshot().assertion).toEqual({id: "a-text", title: "Документ", label: "Содержимое", value})
    expect(app.getSnapshot().assertion!.value).toBe(value)
    for (const [id, actual] of [["empty", ""], ["false", false], ["null", null]] as const) {
      app.selectAssertion(`a-${id}`)
      expect(app.getSnapshot().assertion!.value).toBe(actual)
    }
    app.select("a")
    expect(app.getSnapshot().assertion).toBeUndefined()
    app.selectAssertion("a-text")
    app.select("b")
    expect(app.getSnapshot().assertion).toBeUndefined()
    expect(() => app.selectAssertion("a-text")).toThrow("Неизвестная проверка")
    expect(variants[0]).not.toHaveProperty("assertion")
  } finally { app.dispose() }
})

test("выбор expect не обращается к серверному запуску после получения результата", async () => {
  let calls = 0
  const point = {title: "Результат", assertions: [{id: "one", label: "Текст", value: "Прочитано"}]}
  const app = createApp({kind: "function", variants: [{id: "a", title: "a", source: "read()", points: [], calls: []}],
    async run() { calls += 1; return {source: "read()", calls: [], points: [point], execution: {status: "passed", tests: [{label: "Результат", status: "passed", message: null}]}} },
  })
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    app.selectAssertion("one")
    app.select("a")
    expect(calls).toBe(1)
    expect(app.getSnapshot().points).toEqual([point])
  } finally { app.dispose() }
})
