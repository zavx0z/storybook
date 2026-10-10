import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import {RequestList} from "../mcp-window/src/request-list"
import {createWindowHost} from "./fixture/mcp-window-host"

test("скрытие освобождает строки редактора и восстанавливает полный ответ", async () => {
  const host = createWindowHost()
  const entries = [{id: "large", tool: "storybook_status", startedAt: 1, durationMs: 1, status: "success" as const,
    input: "{}", result: JSON.stringify(Array.from({length: 100}, (_, index) => ({index, value: "Строка"})))}]
  const render = async (active: boolean) => {
    const props = {entries, error: "", active}
    host.component.render(RequestList as unknown as CompiledTemplate<typeof props>, props)
    await host.settle()
  }
  try {
    await render(true)
    const code = host.container.querySelectorAll("code")[1]!
    expect(code.textContent).toBe(JSON.stringify(JSON.parse(entries[0]!.result), null, 2))
    await render(false)
    expect(host.container.querySelectorAll("[data-line-index]").length).toBeLessThanOrEqual(4)
    expect(code.textContent).toBe("")
    await render(true)
    expect(host.container.querySelectorAll("code")[1]).toBe(code)
    expect(code.textContent).toBe(JSON.stringify(JSON.parse(entries[0]!.result), null, 2))
  } finally { host.dispose() }
})
