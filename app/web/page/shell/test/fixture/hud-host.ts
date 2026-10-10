import {createRoot} from "@zavx0z/immersive/XReact"
import {createDocument, type Element, type HTMLButtonElement} from "@zavx0z/immersive"
import {flushDocumentLayoutObservers} from "@zavx0z/immersive"
import {createDocumentInteractionController, createDocumentRenderer, hitTestProjection} from "@zavx0z/immersive/renderer/html"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import {StorybookHud} from "../../src/hud"
import type {StorybookAppProps} from "../../src/application-props"
import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"

const theme = await Bun.file(Bun.resolveSync("@zavx0z/immersive/ui/theme.css", import.meta.dir)).text()

/** Проекция настоящего HUD в одном Document использует публичные layout и input API без GPU. */
export function createHudHost() {
  const document = createDocument()
  const space = document.createElement("space")
  document.append(space)
  const component = createRoot(space)
  return {
    document,
    render(application: StorybookAppProps, workbench: Pick<StorybookAppWebPageShellWorkbench.Output, "getSnapshot" | "subscribe">) {
      // HUD читает только модель каталога; Display и его View здесь не монтируются.
      const props = {application, workbench: workbench as StorybookAppWebPageShellWorkbench.Output}
      component.render(StorybookHud as unknown as CompiledTemplate<typeof props>, props)
      const container = space.querySelector("hud")!
      const renderer = createDocumentRenderer({document, root: container, viewport: {width: 1000, height: 800}, styleSheets: [theme]})
      const input = createDocumentInteractionController({document, hitTest: hitTestProjection})
      const settle = async () => {
        await Bun.sleep(0)
        for (let round = 0; round < 5; round++) {
          component.flush()
          renderer.flush()
          if (!flushDocumentLayoutObservers(document)) {
            component.flush()
            return renderer.flush()
          }
        }
        throw new Error("HUD layout did not settle")
      }
      return {
        document, container, component, renderer, input, settle,
        button(name: string) {
          const button = [...container.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === name || node.textContent === name) as HTMLButtonElement | undefined
          if (!button) throw new Error(`Нет кнопки ${name}`)
          return button
        },
        bounds(element: Element) {
          const {x, y, width, height} = element.getBoundingClientRect()
          return {x, y, width, height}
        },
        dispose() {
          component.unmount()
          input.dispose()
          renderer.dispose()
        },
      }
    },
  }
}
