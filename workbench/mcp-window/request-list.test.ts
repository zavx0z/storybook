import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {createRoot} from "@zavx0z/component"
import {createDocument, MouseEvent} from "@zavx0z/dom"
import {createDocumentRenderer} from "@renderer/html"
import {createTemplateJsxBunPlugin} from "@zavx0z/template/bun"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {readScenarios} from "@mcp/rest/scenarios"
import {traceMcpRequest} from "../../mcp/server/src/request-log"

const root = resolve(import.meta.dir, "../..")
Bun.plugin(createTemplateJsxBunPlugin({cwd: root, persistent: true, sourceRoots: [resolve(root, "workbench")]}))
const {RequestList} = await import("./src/request-list.tsx")

test("журнал монтирует одну команду и сохраняет весь длинный ответ при переключении", async () => {
  const document = createDocument()
  const container = document.createElement("div")
  document.append(container)
  const component = createRoot(container)
  const renderer = createDocumentRenderer({document, root: container, viewport: {width: 620, height: 400}})
  const response = JSON.stringify({lines: Array.from({length: 3100}, (_, index) => `Строка ${index}`), end: "КОНЕЦ ОТВЕТА"}, null, 2)
  const entries: McpRequestRecord[] = Array.from({length: 20}, (_, index) => ({
    id: String(index), tool: `storybook-${index}`, startedAt: 20 - index, durationMs: 1, status: "success", input: "{}", result: response,
  }))
  try {
    component.render(RequestList as unknown as CompiledTemplate<{entries: readonly McpRequestRecord[], error: string}>, {entries, error: ""})
    expect(container.querySelectorAll("article")).toHaveLength(1)
    expect(container.querySelectorAll("code")).toHaveLength(2)
    expect(container.querySelectorAll("code")[1]!.textContent).toBe(response)
    const previousEditor = container.querySelectorAll("code")[1]!
    expect(renderer.flush().boxByNode.has(container.querySelector("article")!)).toBeTrue()
    const previous = [...container.querySelectorAll("button")].find(button => button.textContent === "Предыдущая команда")!
    previous.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    await Bun.sleep(0)
    expect(container.querySelectorAll("article")).toHaveLength(1)
    expect(container.querySelector("article")!.textContent).toContain("storybook-1")
    expect(container.querySelectorAll("code")[1]).not.toBe(previousEditor)
    expect(container.querySelectorAll("code")[1]!.textContent).toBe(response)
    expect(renderer.flush().boxByNode.has(container.querySelector("article")!)).toBeTrue()
  } finally {
    renderer.dispose()
    component.unmount()
  }
}, 15_000)

test("журнал раскрывает реальный ответ руководства сценариев целиком", async () => {
  const owner = resolve(root, "archetypes/specs/scenarios")
  const {scenarios} = await readScenarios({path: owner, source: resolve(owner, "spec/scenario.spec.ts"), format: "data"})
  let entry: McpRequestRecord | undefined
  await traceMcpRequest("storybook", {node: "archetypes/specs/scenarios"}, async () => ({node: "archetypes/specs/scenarios", children: [], scenarios}), async record => { entry = record as unknown as McpRequestRecord })
  const document = createDocument()
  const container = document.createElement("div")
  document.append(container)
  const component = createRoot(container)
  const renderer = createDocumentRenderer({document, root: container, viewport: {width: 620, height: 400}})
  try {
    component.render(RequestList as unknown as CompiledTemplate<{entries: readonly McpRequestRecord[], error: string}>, {entries: [entry!], error: ""})
    expect(container.querySelectorAll("article")).toHaveLength(1)
    expect(container.querySelectorAll("code")[1]!.textContent).toBe(entry!.result)
    expect(renderer.flush().boxByNode.has(container.querySelector("article")!)).toBeTrue()
  } finally {
    renderer.dispose()
    component.unmount()
  }
}, 20_000)
