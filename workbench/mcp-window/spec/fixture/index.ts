import {resolve} from "node:path"
import {createRoot} from "@zavx0z/component"
import {createDocument, MouseEvent} from "@zavx0z/dom"
import type {Element} from "@zavx0z/dom"
import {createDocumentInteractionController, createDocumentRenderer} from "@renderer/html"
import {createTemplateJsxBunPlugin} from "@zavx0z/template/bun"
import type {McpRequestRecord} from "@mcp/rest/requests"

const repository = resolve(import.meta.dir, "../../../..")
Bun.plugin(createTemplateJsxBunPlugin({cwd: repository, persistent: true, sourceRoots: [resolve(repository, "workbench")]}))
const theme = await Bun.file(Bun.resolveSync("@zavx0z/ui/themes/theme.css", repository)).text()

export const largeResponse = JSON.stringify({
  source: "archetypes/specs/scenarios/spec/scenario.spec.ts",
  variants: [{label: "Сценарий функции", items: Array.from({length: 512}, (_, index) => ({label: `Пункт ${index}`, actual: {index, text: "Полные данные проверки"}}))}],
  end: "КОНЕЦ ПОЛНОГО ОТВЕТА",
}, null, 2)

/** Подготавливает журнал, не заменяя поведение окна или тестовые API. */
export function command(id: string, status: McpRequestRecord["status"] = "success", result = JSON.stringify({id}, null, 2)): McpRequestRecord {
  return {id, tool: `storybook-${id}`, startedAt: 1, durationMs: status === "running" ? null : 20, status, input: JSON.stringify({node: "archetypes/specs/scenarios"}, null, 2), result}
}

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
