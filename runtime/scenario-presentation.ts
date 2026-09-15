import {createRoot} from "@zavx0z/component"
import {createScenarioApp} from "@storybook/app"
import type {ScenarioAppInput} from "@storybook/app/contract/input"
import {ScenarioPreview, type ScenarioPreviewPlacement} from "@storybook/app/preview"
import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {createStorybookComponentPresentation} from "./component-presentation"

/**
Монтирует общую фикстуру в Document страницы и центрирует её по готовой раскладке.
Переход между вариантами сохраняет ComponentRoot и semantic Element компонента.
*/
export function createScenarioPresentation(document: Document, input: ScenarioAppInput) {
  const app = createScenarioApp(input)
  let placement: ScenarioPreviewPlacement = {x: 0, y: 0}
  const template = ScenarioPreview as unknown as CompiledTemplate<Parameters<typeof ScenarioPreview>[0]>
  const view = createStorybookComponentPresentation(document, template, {placement}, "[data-scenario-preview]")
  const stage = view.element.querySelector("[data-scenario-stage]")!
  const fixtureRoot = createRoot(stage)
  try {
    fixtureRoot.render(app.template, app.getSnapshot().props)
  } catch (error) {
    fixtureRoot.unmount()
    view.dispose()
    throw error
  }
  const unsubscribe = app.subscribe(() => fixtureRoot.render(app.template, app.getSnapshot().props))
  let disposed = false
  return Object.freeze({
    ...view,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      fixtureRoot.unmount()
      view.dispose()
    },
    app,
    center() {
      const element = stage.firstElementChild
      if (element === null || !view.element.isConnected) return false
      const viewport = view.element.getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      if (viewport.width <= 0 || viewport.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return false
      const dx = viewport.x + viewport.width / 2 - bounds.x - bounds.width / 2
      const dy = viewport.y + viewport.height / 2 - bounds.y - bounds.height / 2
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return false
      placement = {x: placement.x + dx, y: placement.y + dy}
      view.componentRoot.render(template, {placement})
      return true
    },
  })
}
