import {resolve} from "node:path"
import {createRoot} from "@immersive/component"
import {flushDocumentLayoutObservers} from "@immersive/dom/geometry"
import {createDocument, MouseEvent} from "@immersive/dom"
import type {Element} from "@immersive/dom"
import {createDocumentInteractionController, createDocumentRenderer} from "@immersive-renderer/html"

const repository = resolve(import.meta.dir, "../../../../../../..")
const theme = await Bun.file(Bun.resolveSync("@immersive-ui/component/theme/theme.css", repository)).text()

/** Изолированное окно использует настоящий компонент, Document, layout и ввод; GPU-кадр здесь не проверяется. */
export function createWindowHost() {
  const document = createDocument()
  const container = document.createElement("div")
  document.append(container)
  const component = createRoot(container)
  const renderer = createDocumentRenderer({document, root: container, viewport: {width: 1000, height: 800}, styleSheets: [theme]})
  const input = createDocumentInteractionController({document})
  let disposed = false
  const settle = async () => {
    await Bun.sleep(0)
    component.flush()
    renderer.flush()
    flushDocumentLayoutObservers(document)
    component.flush()
    return renderer.flush()
  }
  const button = (name: string) => {
    const element = [...container.querySelectorAll("button")].find(element => element.getAttribute("aria-label") === name || element.textContent === name)
    if (!element) throw new Error(`Нет кнопки ${name}`)
    return element
  }
  return {
    document, container, component, renderer, input, settle, button,
    async click(name: string) {
      button(name).dispatchEvent(new MouseEvent("click", {bubbles: true}))
      return settle()
    },
    bounds(element: Element) {
      const {x, y, width, height} = element.getBoundingClientRect()
      return {x, y, width, height}
    },
    async waitFor(condition: () => boolean, timeout = 5000) {
      const deadline = performance.now() + timeout
      while (!condition()) {
        if (performance.now() > deadline) throw new Error("Окно не перешло в ожидаемое состояние")
        await Bun.sleep(20)
        component.flush()
      }
      return renderer.flush()
    },
    dispose() {
      if (disposed) return
      disposed = true
      component.unmount()
      input.dispose()
      renderer.dispose()
    },
  }
}
