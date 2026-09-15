import {createRoot} from "@zavx0z/component"
import {createDocument, Event} from "@zavx0z/dom"
import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {createScenarioPresentation} from "../../runtime/scenario-presentation"
import {ScenarioInspector} from "../inspector"
import {StatefulFixture} from "./fixture"

test("выбор варианта сохраняет компонент и его состояние, обновляя общий Editor и аккордеон", async () => {
  const document = createDocument()
  const presentation = createScenarioPresentation(document, {
    template: StatefulFixture as unknown as CompiledTemplate<Record<string, unknown>>,
    variants: ["Первый", "Второй", "Третий"].map((title, index) => ({
      id: String(index), title, props: {name: title},
      source: `<StatefulFixture name=${JSON.stringify(title)} />`,
      points: [{title: `Описание ${title}`}],
    })),
  })
  const inspectorHost = document.createElement("aside")
  const inspector = createRoot(inspectorHost)
  inspector.render(ScenarioInspector as unknown as CompiledTemplate<{value: unknown}>, {value: presentation.app})
  const button = presentation.element.querySelector("[data-fixture]")!
  try {
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
    inspector.unmount()
    presentation.dispose()
  }
})
