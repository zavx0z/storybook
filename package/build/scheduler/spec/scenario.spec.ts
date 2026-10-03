import {describe, expect, test} from "bun:test"
import Scheduler from "@package-build/scheduler"

describe.each([
  {name: "Проверка пакета", props: {id: "button", owner: "check" as const}},
  {name: "Общая сборка", props: {id: "shared", owner: "shared" as const}},
])("$name", async ({props}) => {
  const scheduler = new Scheduler({limit: 1})
  const states: string[] = []
  const unsubscribe = scheduler.subscribe(transition => states.push(transition.state))
  let result!: string
  let recentOperationId: string | undefined
  try {
    result = await scheduler.run({
      operationId: props.id,
      packageId: props.owner === "check" ? "@fixture/button" : null,
      owner: props.owner,
      reason: "missing",
      generation: 1,
      cache: {status: "miss", layer: "package"},
    }, async context => {
      context.setPhase("verification")
      return "built"
    }, new AbortController().signal)
    recentOperationId = scheduler.snapshot().recent[0]?.operationId
  } finally {
    unsubscribe()
    scheduler.dispose()
  }

  test("Результат исполнителя", () => {
    expect(result, "Очередь возвращает результат допущенной пакетной работы")
      .toBe("built")
  })

  test("Переходы жизненного цикла", () => {
    expect(states, "Работа последовательно проходит очередь, допуск и завершение")
      .toEqual(["queued", "running", "running", "completed"])
  })

  test("История завершения", () => {
    expect(recentOperationId, "Завершённая работа остаётся в ограниченной истории координатора")
      .toBe(props.id)
  })
})
