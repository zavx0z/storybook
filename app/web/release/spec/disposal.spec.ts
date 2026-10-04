import {expect, mock, test} from "bun:test"
import createWeb from "@zavx0z/storybook-app-web-release"

test("Завершение из уведомления о публикации исключает позднее применение", async () => {
  const publish = mock((_candidate: string) => {})
  const web = createWeb({
    prepare: async () => "web-b",
    versions: () => [{platform: "platform-a", web: "web-b"}],
    publish,
  })
  let disposal: Promise<void> | undefined
  const unsubscribe = web.subscribe(state => {
    if (state.phase === "publishing") disposal = web.dispose()
  })
  try {
    await expect(web.rebuild({apply: true}), "Завершение до публикации отменяет текущий запрос")
      .rejects.toMatchObject({name: "AbortError"})
    await disposal
    expect(publish.mock.calls, "После завершения подготовленное значение не публикуется").toEqual([])
    await expect(web.rebuild(), "Завершённый Web отклоняет новые запросы").rejects.toThrow("Приложение завершает работу")
  } finally {
    unsubscribe()
    await web.dispose()
  }
})
