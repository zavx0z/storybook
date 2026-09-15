import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {createHeadless} from "@immersive/headless"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {command} from "../spec/fixture"
import {readScenarios} from "@mcp/rest/scenarios"
import {traceMcpRequest} from "../../../mcp/server/src/request-log"
import type {McpRequestRecord} from "@mcp/rest/requests"

const {JournalGpuContent} = await import("./gpu-content.fixture.tsx")

/** @remarks Нативный GPU-прогон включается отдельно через MCP_WINDOW_GPU=1, чтобы не нагружать Mac обычными unit-прогонами. */
test.skipIf(process.env.MCP_WINDOW_GPU !== "1")("GPU: running → полный реальный ответ → повторный кадр", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const owner = resolve(root, "archetypes/specs/scenarios")
  const {scenarios} = await readScenarios({path: owner, source: resolve(owner, "spec/scenario.spec.ts"), format: "data"})
  let record: McpRequestRecord | undefined
  await traceMcpRequest("storybook", {node: "archetypes/specs/scenarios"}, async () => ({node: "archetypes/specs/scenarios", children: [], scenarios}), async value => { record = value as unknown as McpRequestRecord })
  let entries = [command("gpu", "running", "")]
  const headless = createHeadless({projectRoot: root, width: 1000, height: 800})
  const started = performance.now()
  console.info("GPU: подготовлен ответ", Buffer.byteLength(record!.result))
  try {
    const template = JournalGpuContent as unknown as CompiledTemplate<{entries: readonly McpRequestRecord[]}>
    const element = await headless.render(template, {entries})
    console.info("GPU: первый кадр", Math.round(performance.now() - started))
    entries = [{...record!, id: "gpu"}]
    await headless.render(template, {entries})
    console.info("GPU: обновление ответа", Math.round(performance.now() - started))
    const first = await headless.screenshot(element)
    console.info("GPU: полный кадр", Math.round(performance.now() - started))
    const second = await headless.screenshot(element)
    console.info("GPU: повторный кадр", Math.round(performance.now() - started))
    expect(element.querySelectorAll("article")).toHaveLength(1)
    expect(element.querySelectorAll("code")[1]!.textContent).toBe(record!.result)
    expect([first.byteLength > 0, second.byteLength > 0]).toEqual([true, true])
  } finally {
    await headless.dispose()
  }
}, 40000)
