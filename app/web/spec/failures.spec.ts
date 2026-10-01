import {expect, mock, test} from "bun:test"
import createWeb, {type AppWeb} from "@app/web"

const versions = [{platform: "platform-a", web: "web-b"}] as const

test("Ошибка подготовки сохраняет выпуск и допускает исправленный запрос", async () => {
  let published = "web-a"
  let fail = true
  const web = createWeb({
    prepare: async () => {
      if (fail) throw new Error("compiler rejected")
      return "web-b"
    },
    versions: () => versions,
    publish(candidate) { published = candidate },
  })
  try {
    await expect(web.rebuild({apply: true}), "Ошибка сборщика отклоняет запрос применения").rejects.toThrow("compiler rejected")
    expect(web.read(), "Состояние сохраняет причину отказа").toMatchObject({phase: "failed", error: "compiler rejected"})
    expect(published, "Неудачная подготовка не заменяет работающий выпуск").toBe("web-a")
    fail = false
    expect(await web.rebuild({apply: true}), "Исправленный запрос публикует выпуск и очищает прежнюю ошибку")
      .toMatchObject({phase: "published", error: null})
    expect(published, "Повторная попытка передаёт новый выпуск владельцу публикации").toBe("web-b")
  } finally {
    await web.dispose()
  }
})

test("Ошибка первого уведомления удаляет только отказавшего наблюдателя", async () => {
  const publish = mock((_candidate: string) => {})
  const web = createWeb({prepare: async () => "web-b", versions: () => versions, publish})
  const failedListener = mock(() => { throw new Error("observer failed") })
  const listener = mock((_state: ReturnType<AppWeb.Output["read"]>) => {})
  const unsubscribeFailed = web.subscribe(failedListener)
  const unsubscribe = web.subscribe(listener)
  try {
    expect(await web.rebuild({apply: true}), "Ошибка наблюдателя не срывает публикацию").toMatchObject({phase: "published"})
    expect(failedListener.mock.calls, "Отказавшая при подключении подписка больше не получает уведомлений").toHaveLength(1)
    expect(listener.mock.calls.map(([state]) => state.phase), "Исправный наблюдатель получает весь жизненный цикл")
      .toEqual(["idle", "preparing", "prepared", "publishing", "published"])
    expect(publish.mock.calls, "Публикация выполняется один раз с подготовленным значением").toEqual([["web-b"]])
  } finally {
    unsubscribeFailed()
    unsubscribe()
    await web.dispose()
  }
})
