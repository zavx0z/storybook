/**
Управляемый Presentation показывает render, ожидание готовности, повторный render
и освобождение через публичный Browser Fixture. Seam наблюдает только поля,
которыми пользуется fixture; renderer и semantic Document здесь не создаются.

@packageDocumentation
*/
import {describe, expect, mock, test} from "bun:test"
import presentationRootFixture, {type StorybookTechTestingBrowserRoot} from "@storybook-tech-testing/browser-root"

type Presentation = Awaited<ReturnType<StorybookTechTestingBrowserRoot.Input>>
type Application = NonNullable<Parameters<ReturnType<StorybookTechTestingBrowserRoot.Output>["render"]>[0]>

describe.each([
  {name: "Повторное использование готового Presentation", props: {canvas: {} as HTMLCanvasElement}},
])("$name", ({props}) => {
  const unmount = mock(() => {})
  const renderApplication = mock((_app: Application) => {})
  // Контролируемая seam: Browser Fixture обращается только к renderApplication и unmount.
  const presentation = {unmount, renderApplication} as unknown as Presentation
  const factory = mock((async (_options: Parameters<StorybookTechTestingBrowserRoot.Input>[0]) => presentation) as StorybookTechTestingBrowserRoot.Input)
  const createRoot = presentationRootFixture(factory)

  test("Полный жизненный цикл", async () => {
    const firstApplication = {fixture: "first"} as unknown as Application
    const nextApplication = {fixture: "next"} as unknown as Application
    const root = createRoot(props.canvas)
    try {
      root.render(firstApplication)
      const ready = await root.whenReady()
      expect(ready, "whenReady возвращает готовый Presentation предоставленной фабрики").toBe(presentation)
      expect(factory.mock.calls, "Первый render передаёт фабрике точные Canvas и application")
        .toEqual([[{canvas: props.canvas, app: firstApplication}]])

      root.render(nextApplication)
      expect(await root.whenReady(), "Повторный render сохраняет Presentation").toBe(presentation)
      expect(renderApplication.mock.calls, "Готовый Presentation принимает только новое application")
        .toEqual([[nextApplication]])
      expect(factory.mock.calls.length, "Повторный render не создаёт второй Presentation").toBe(1)
    } finally {
      root.unmount()
      await Promise.resolve()
    }
    expect(unmount.mock.calls, "Завершение fixture освобождает готовый Presentation ровно один раз")
      .toEqual([[]])
  })
})
