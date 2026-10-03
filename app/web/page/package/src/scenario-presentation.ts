import {createRoot} from "@zavx0z/component"
import createScenarioApp from "@scenario/model"
import type {ScenarioModel} from "@scenario/model"
/** Форма исходного публичного владельца. */
type ScenarioAppInput = ScenarioModel.Input
import ScenarioPreview from "@scenario/preview"
import ScenarioResult from "@scenario/result"
import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import createStorybookComponentPresentation from "@web/presentation"

/**
Монтирует общую фикстуру после успешного теста; CSS Preview владеет её расположением.
Переход между вариантами сохраняет ComponentRoot и semantic Element компонента.
Для функции монтируется только редактор сохранённого результата в том же Document.
*/
export function createScenarioPresentation(document: Document, input: ScenarioAppInput) {
  const app = createScenarioApp(input)
  if (input.kind === "function") {
    const template = ScenarioResult as unknown as CompiledTemplate<{app: typeof app}>
    const view = createStorybookComponentPresentation(document, template, {app}, "[data-scenario-result]")
    return Object.freeze({...view, app, dispose() {
      app.dispose()
      view.dispose()
    }})
  }
  const fixtureProps = () => {
    const selected = app.getSnapshot()
    if (!("props" in selected) || selected.props === undefined) throw new TypeError("Нет props компонента")
    return input.resolveProps?.(selected.id, selected.props) ?? selected.props
  }
  const template = ScenarioPreview as unknown as CompiledTemplate<Parameters<typeof ScenarioPreview>[0]>
  const view = createStorybookComponentPresentation(document, template, {app}, "[data-scenario-preview]")
  const stage = view.element.querySelector("[data-scenario-stage]")!
  const fixtureRoot = createRoot(stage)
  const updateFixture = () => {
    if (input.run !== undefined && app.getSnapshot().execution?.status !== "passed") return
    fixtureRoot.render(input.template, fixtureProps())
  }
  try {
    updateFixture()
  } catch (error) {
    app.dispose()
    fixtureRoot.unmount()
    view.dispose()
    throw error
  }
  const unsubscribe = app.subscribe(updateFixture)
  let disposed = false
  return Object.freeze({
    ...view,
    dispose() {
      if (disposed) return
      disposed = true
      app.dispose()
      unsubscribe()
      fixtureRoot.unmount()
      view.dispose()
    },
    app,
  })
}
