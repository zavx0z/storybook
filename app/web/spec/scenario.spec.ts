/**
Подготовка и явная публикация Web через предоставленного владельца артефактов.
Примеры показывают одну общую операцию, её наблюдение и отключение подписки.
*/
import {afterAll, describe, expect, mock, test} from "bun:test"
import createWeb, {type AppWeb} from "@app/web"

const versions = [{platform: "platform-a", web: "web-b"}] as const

describe.each([
  {name: "Подготовка без публикации", apply: false, join: "none", joinApply: false, disconnect: false, phase: "prepared"},
  {name: "Явная публикация", apply: true, join: "none", joinApply: false, disconnect: false, phase: "published"},
  {name: "Применение по конкурентному запросу", apply: false, join: "request", joinApply: true, disconnect: false, phase: "published"},
  {name: "Подготовка не отменяет запрошенное применение", apply: true, join: "request", joinApply: false, disconnect: false, phase: "published"},
  {name: "Применение из уведомления о подготовке", apply: false, join: "observer", joinApply: true, disconnect: false, phase: "published"},
  {name: "Отключение наблюдателя", apply: true, join: "none", joinApply: false, disconnect: true, phase: "published"},
])("$name", async ({apply, join, joinApply, disconnect, phase}) => {
  const prepared = Promise.withResolvers<string>()
  let published = "web-a"
  const props = {
    prepare: mock((_signal: AbortSignal) => prepared.promise),
    versions: mock((_candidate: string) => versions),
    publish: mock((candidate: string) => { published = candidate }),
  } satisfies AppWeb.Input<string>
  const web = createWeb(props)
  afterAll(() => web.dispose())
  const initial = web.read()
  const initialCalls = props.prepare.mock.calls.length
  let joined: ReturnType<AppWeb.Output["rebuild"]> | undefined
  const listener = mock((state: ReturnType<AppWeb.Output["read"]>) => {
    if (join === "observer" && state.phase === "preparing") joined = web.rebuild({apply: joinApply})
  })
  const unsubscribe = web.subscribe(listener)
  afterAll(unsubscribe)
  const operation = web.rebuild({apply})
  if (join === "request") joined = web.rebuild({apply: joinApply})
  if (disconnect) unsubscribe()
  prepared.resolve("web-b")
  const result = await operation

  test("Создание", () => {
    expect(initial.phase, "Создание оставляет Web в исходном состоянии").toBe("idle")
    expect(initialCalls, "Подготовка начинается только по явному запросу").toBe(0)
    expect(initial.operationId, "До первого запроса операция отсутствует").toBeNull()
  })

  test("Подготовленный результат", () => {
    expect(props.prepare.mock.calls, "Одна операция вызывает подготовку ровно один раз").toHaveLength(1)
    expect(props.versions.mock.calls, "Версии извлекаются из того же подготовленного значения").toEqual([["web-b"]])
    expect(result.versions, "Выпуск сохраняет соответствие Web готовой платформе").toEqual(versions)
    expect(web.read(), "Чтение возвращает итоговый снимок без повторной подготовки").toBe(result)
  })

  test("Публикация", () => {
    expect(result.phase, "Применение запрашивается участником общей операции").toBe(phase)
    expect(props.publish.mock.calls, "Только запрос применения передаёт артефакт в публикацию")
      .toEqual(phase === "published" ? [["web-b"]] : [])
    expect(published, "Подготовка без применения сохраняет прежний опубликованный выпуск")
      .toBe(phase === "published" ? "web-b" : "web-a")
  })

  test("Наблюдение", () => {
    expect(listener.mock.calls.map(([state]) => state.phase),
      "Подписка сразу сообщает исходное состояние; отключение прекращает уведомления без отмены операции")
      .toEqual(disconnect ? ["idle", "preparing"] : phase === "published"
        ? ["idle", "preparing", "prepared", "publishing", "published"]
        : ["idle", "preparing", "prepared"])
  })

  /** @remarks Только варианты с дополнительным запросом сравнивают общий Promise. */
  describe.skipIf(join === "none")("Общая операция", () => {
    test("Присоединение", () => {
      expect(joined, "Конкурентный запрос, включая запрос из наблюдателя, получает тот же Promise").toBe(operation)
    })
  })
})
