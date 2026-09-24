import {createRoot} from "@zavx0z/component"
import {createDocument, Event, type HTMLElement} from "@zavx0z/dom"
import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {ScenarioAppInput} from "@storybook/app/contract/input"
import {createDocumentRenderer} from "@renderer/html"
import {createScenarioPresentation} from "./scenario-presentation"
import {ScenarioInspector} from "@storybook/app/inspector"
import {StatefulFixture} from "../app/spec/fixture"

test("Компонент монтируется только после успешного теста с проверенными props", async () => {
  type Run = NonNullable<ScenarioAppInput["run"]>
  const pending: {resolve: (result: Awaited<ReturnType<Run>>) => void, signal: AbortSignal}[] = []
  const presentation = createScenarioPresentation(createDocument(), {
    kind: "component",
    template: StatefulFixture as unknown as CompiledTemplate<Record<string, unknown>>,
    variants: ["Первый", "Второй", "Третий"].map((title, index) => ({
      id: String(index), title, props: {name: title}, source: title, points: [],
    })),
    run: (_, signal) => new Promise(resolve => pending.push({resolve, signal})),
  })
  const complete = (status: "passed" | "failed", name: string) => ({
    source: name, props: {name}, calls: [], points: [], execution: {status, tests: []},
  })
  const stage = presentation.element.querySelector("[data-scenario-stage]")!
  try {
    await Promise.resolve()
    expect(stage.querySelector("[data-fixture]")).toBeNull()
    expect(stage.getAttribute("data-hidden")).toBe("true")
    pending[0]!.resolve(complete("failed", "Не показывать"))
    await Bun.sleep(0)
    presentation.componentRoot.flush()
    expect(stage.querySelector("[data-fixture]")).toBeNull()
    expect(presentation.element.textContent).toContain("Проверки завершились с ошибками")

    presentation.app.select("1")
    await Promise.resolve()
    pending[1]!.resolve(complete("passed", "Проверенное имя"))
    await Bun.sleep(0)
    presentation.componentRoot.flush()
    const button = stage.querySelector("[data-fixture]")!
    expect(button.textContent).toBe("Проверенное имя: 0")
    expect(stage.getAttribute("data-hidden")).toBe("false")
    button.dispatchEvent(new Event("click"))
    await Bun.sleep(0)

    presentation.app.select("2")
    await Promise.resolve()
    presentation.componentRoot.flush()
    expect(stage.getAttribute("data-hidden")).toBe("true")
    expect(button.textContent).toBe("Проверенное имя: 1")
    pending[2]!.resolve(complete("failed", "Ошибка третьего"))
    await Bun.sleep(0)
    presentation.componentRoot.flush()
    expect(stage.getAttribute("data-hidden")).toBe("true")
    expect(button.textContent).toBe("Проверенное имя: 1")

    presentation.app.select("1")
    await Promise.resolve()
    pending[3]!.resolve(complete("passed", "Возврат"))
    await Bun.sleep(0)
    presentation.componentRoot.flush()
    expect(stage.querySelector("[data-fixture]")).toBe(button)
    expect(button.textContent).toBe("Возврат: 1")
    expect(stage.getAttribute("data-hidden")).toBe("false")
  } finally {
    presentation.dispose()
  }
})

test("Живой вывод заменяется результатом только после завершения", async () => {
  type Run = NonNullable<Extract<ScenarioAppInput, {kind: "function"}>["run"]>
  let progress!: Parameters<Run>[2]
  let finish!: (result: Awaited<ReturnType<Run>>) => void
  const presentation = createScenarioPresentation(createDocument(), {
    kind: "function",
    variants: [{id: "0", title: "Пример", source: "run()", calls: [], points: []}],
    run: (_, __, onProgress) => new Promise(resolve => {
      progress = onProgress
      finish = resolve
    }),
  })
  try {
    await Promise.resolve()
    progress({phase: "running", text: "(pass) Первая проверка\n"})
    presentation.componentRoot.flush()
    expect(presentation.element.textContent).toContain("Первая проверка")
    expect(presentation.element.textContent).not.toContain("Проверки пройдены")
    finish({source: "run()", points: [], calls: [{id: 0, source: "run()", outcome: {type: "return", value: "готово"}}],
      execution: {status: "passed", tests: []}})
    await Bun.sleep(0)
    presentation.componentRoot.flush()
    expect(presentation.element.textContent).toContain("готово")
    expect(presentation.element.textContent).not.toContain("Первая проверка")
  } finally {
    presentation.dispose()
  }
})

test("выбор варианта сохраняет компонент и его состояние, обновляя общий Editor и аккордеон", async () => {
  const document = createDocument()
  const presentation = createScenarioPresentation(document, {
    kind: "component",
    template: StatefulFixture as unknown as CompiledTemplate<Record<string, unknown>>,
    variants: ["Первый", "Второй", "Третий"].map((title, index) => ({
      id: String(index), title, props: {name: title},
      source: `<StatefulFixture name=${JSON.stringify(title)} />`,
      points: [{title: `Описание ${title}`}],
    })),
  })
  let inspector: ReturnType<typeof createRoot> | undefined
  try {
    const inspectorHost = document.createElement("aside")
    inspector = createRoot(inspectorHost)
    inspector.render(ScenarioInspector as unknown as CompiledTemplate<{value: unknown}>, {value: presentation.app})
    const button = presentation.element.querySelector("[data-fixture]")!
    expect(inspectorHost.querySelector('[title="Декларация компонента"]'), "Редактор декларации не перекрывается повторяющей его назначение подсказкой").toBeNull()
    button.dispatchEvent(new Event("click"))
    await Promise.resolve()
    for (const variant of presentation.app.variants.slice(1).concat(presentation.app.variants.slice(0, 1))) {
      const toggle = [...inspectorHost.querySelectorAll("button")].find(item => item.textContent === variant.title)!
      toggle.dispatchEvent(new Event("click"))
      inspector.flush()
      await Promise.resolve()
      expect(presentation.element.querySelector("[data-fixture]")).toBe(button)
      expect(button.textContent).toBe(`${variant.title}: 1`)
      expect(presentation.app.getSnapshot().source).toBe(variant.source)
      expect(inspectorHost.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1)
      expect(inspectorHost.textContent).toContain(variant.title)
    }
  } finally {
    inspector?.unmount()
    presentation.dispose()
  }
})

test("Editor остаётся сверху, пока прокручивается только список вариантов", () => {
  const document = createDocument()
  const presentation = createScenarioPresentation(document, {
    kind: "component",
    template: StatefulFixture as unknown as CompiledTemplate<Record<string, unknown>>,
    variants: [{
      id: "long",
      title: "Длинный сценарий",
      props: {name: "Длинный сценарий"},
      source: '<StatefulFixture name="Длинный сценарий" />',
      points: Array.from({length: 80}, (_, index) => ({
        title: `Пункт ${index + 1}`,
        content: "Подробное описание пункта сценария",
      })),
    }],
  })
  const inspectorHost = document.createElement("aside")
  inspectorHost.setAttribute("style", "display:flex;width:400px;height:600px")
  document.append(inspectorHost)
  const inspector = createRoot(inspectorHost)
  inspector.render(ScenarioInspector as unknown as CompiledTemplate<{value: unknown}>, {value: presentation.app})
  const renderer = createDocumentRenderer({
    document,
    root: inspectorHost,
    viewport: {width: 400, height: 600},
  })
  try {
    const editor = inspectorHost.querySelector('[data-language-id="typescript"]')!
    const variants = inspectorHost.querySelector("[data-scenario-variants]") as HTMLElement
    const initial = renderer.flush()
    const editorBox = initial.boxByNode.get(editor)
    expect(initial.boxByNode.get(inspectorHost.querySelector("[data-scenario-inspector]")!)?.height).toBe(600)
    expect(initial.scrolls.get(variants)?.maxScrollTop).toBeGreaterThan(0)
    variants.scrollTop = 160
    const scrolled = renderer.flush()
    expect(scrolled.scrolls.get(variants)?.scrollTop).toBe(160)
    expect(scrolled.boxByNode.get(editor)).toEqual(editorBox)
  } finally {
    renderer.dispose()
    inspector.unmount()
    presentation.dispose()
  }
})

test("снимки функции переключаются в редакторе JSON без template", async () => {
  const document = createDocument()
  const input: ScenarioAppInput = {
    kind: "function",
    variants: [
      {id: "root", title: "Корневой пакет", source: 'await readPackage({path: "root"})', points: [{title: "Данные пакета", content: "Содержимое package.json"}],
        calls: [{id: 1, source: 'await readPackage({path: "root"})', outcome: {type: "resolve", value: {name: "root", empty: []}}}]},
      {id: "nested", title: "Вложенный пакет", source: 'await readPackage({path: "nested"})', points: [{title: "Данные пакета"}],
        calls: [{id: 2, source: 'await readPackage({path: "nested"})', outcome: {type: "resolve", value: {name: "nested", enabled: false}}}]},
      {id: "error", title: "Ошибка чтения", source: 'await readPackage({path: "missing"})', points: [{title: "Причина ошибки"}],
        calls: [{id: 3, source: 'await readPackage({path: "missing"})', outcome: {type: "reject", error: {message: "Файл отсутствует"}}}]},
    ],
  }
  const original = JSON.stringify(input)
  const presentation = createScenarioPresentation(document, input)
  let inspector: ReturnType<typeof createRoot> | undefined
  try {
    const inspectorHost = document.createElement("aside")
    inspector = createRoot(inspectorHost)
    inspector.render(ScenarioInspector as unknown as CompiledTemplate<{value: unknown}>, {value: presentation.app})
    const editor = presentation.element.querySelector('[data-language-id="json"]')!
    expect(editor).not.toBeNull()
    expect(editor.getAttribute("title"), "Редактор результата не создаёт всплывающую подсказку").toBeNull()
    expect(editor.getAttribute("aria-readonly")).toBe("true")
    expect(presentation.element.textContent).toContain('"root"')
    for (const variant of input.variants.slice(1)) {
      const toggle = [...inspectorHost.querySelectorAll("button")].find(item => item.textContent === variant.title)!
      toggle.dispatchEvent(new Event("click"))
      inspector.flush()
      presentation.componentRoot.flush()
      await Promise.resolve()
      expect(presentation.app.getSnapshot().source).toBe(variant.source)
      if (variant.id === "nested") {
        expect(editor.textContent).toContain('"nested"')
        expect(editor.textContent).toContain('"enabled": false')
        expect(editor.textContent).not.toContain('"root"')
      }
      expect(presentation.element.querySelector('[data-language-id="json"]')).toBe(editor)
      expect(inspectorHost.querySelector('[data-language-id="typescript"]')?.textContent).toContain("readPackage")
      expect(inspectorHost.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1)
    }
    expect(presentation.element.textContent).toContain("Ошибка выполнения")
    expect(presentation.element.textContent).toContain("Файл отсутствует")
    expect(JSON.stringify(input), "Просмотр не изменяет подготовленные снимки").toBe(original)
    expect(presentation.center()).toBeFalse()
  } finally {
    inspector?.unmount()
    presentation.dispose()
  }
})
