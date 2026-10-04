/** Очередь ограничивает исполнение и сохраняет результаты каждой завершённой работы. */
import {afterAll, describe, expect, test} from "bun:test"
import StorybookTechBuildQueue from "@zavx0z/storybook-tech-build-queue"

describe.each([
  {name: "Последовательное исполнение", props: {limit: 1}},
  {name: "Два одновременных исполнителя", props: {limit: 2}},
])("$name", async ({props}) => {
  const queue = new StorybookTechBuildQueue<{label: string}>(props)
  afterAll(() => queue.dispose())
  type Transition = Parameters<Parameters<typeof queue.subscribe>[0]>[0]
  const transitions: Transition[] = []
  const unsubscribe = queue.subscribe(event => transitions.push(event))
  afterAll(unsubscribe)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const jobs = ["один", "два", "три"].map(label => queue.run({details: {label}}, async context => {
    context.setPhase("исполнение")
    await gate
    return label
  }, new AbortController().signal))
  const during = queue.snapshot()
  release()
  const results = await Promise.all(jobs)
  const completed = queue.snapshot()

  test("Допуск", () => {
    expect(during.activeCount, "Одновременно исполняется не больше заданного числа работ").toBe(props.limit)
    expect(during.queuedCount, "Остальные работы ждут освобождения slot").toBe(3 - props.limit)
  })
  test("Результаты", () => {
    expect(results, "Каждый вызывающий получает результат своей работы").toEqual(["один", "два", "три"])
  })
  test("Освобождение", () => {
    expect(completed.activeCount, "Завершённые работы освобождают исполнителей").toBe(0)
    expect(completed.queuedCount, "Все ожидавшие работы получают возможность завершиться").toBe(0)
  })
  test("Свидетельства", () => {
    expect(completed.recent.map(item => item.outcome), "История сохраняет исход каждой работы").toEqual(["completed", "completed", "completed"])
    expect(transitions.filter(event => event.state === "completed").length, "Завершение публикуется один раз для каждой работы").toBe(3)
  })
})
