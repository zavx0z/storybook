import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import type {StorybookAppWebPageShellMcpWindow} from "../contract"
type McpWindowProps = StorybookAppWebPageShellMcpWindow.Input
import {createWindowHost} from "../spec/fixture"
import {command} from "../spec/fixture/records"

const {default: McpWindow} = await import("../index.tsx")

test("поле documentation остаётся частью полного JSON без представления для приложения", async () => {
  const host = createWindowHost()
  const payload = {
    documentation: "# Сценарии\n\nОписание и пример: `expect(result).toBe(2)`",
    contents: [{variant: "Сценарий функции", sections: [{label: "Пункт", children: []}]}],
    verification: {passed: 1, unchecked: 0},
  }
  const entry = command("document", "success", JSON.stringify(payload, null, 2))
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {open: true, onClose() {}, load: async () => [entry]})
    await host.settle()
    expect(host.container.querySelectorAll("code")[1]?.textContent).toBe(entry.result)
    expect(host.container.querySelector("[data-markdown]")).toBeNull()
    expect([...host.container.querySelectorAll("button")].map(button => button.textContent)).not.toContain("Показать JSON ответа")
    expect(JSON.parse(entry.result)).toEqual(payload)
  } finally {
    host.dispose()
  }
}, 15000)

test("мягкие переносы обновляются при завершении того же запроса", async () => {
  const host = createWindowHost()
  let entry = command("updated", "running", "{}")
  const load = async () => [entry]
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {open: true, onClose() {}, load})
    await host.settle()
    const value = {description: "Длинное новое описание\nПродолжение ответа"}
    entry = command("updated", "success", JSON.stringify(value))
    await host.waitFor(() => host.container.querySelectorAll("code")[1]?.textContent === JSON.stringify(value, null, 2))
    expect(host.container.querySelector('[data-line-continuation="true"]')?.textContent).toContain("Продолжение ответа")
  } finally {
    host.dispose()
  }
}, 15000)

test("схемы показаны тем же полным JSON, который получает агент", async () => {
  const host = createWindowHost()
  const payload = {
    path: "storybook/specs/scenarios",
    description: "Читает руководство по пути к сценарию.\nТот же ответ видит агент.",
    children: [],
    input: {type: "object", properties: {path: {type: "string", description: "Путь к сценарию."}}, required: ["path"]},
    output: {type: "object", properties: {files: {type: "array", items: {type: "string"}}}},
    scenarios: ['test("Руководство", () => expect(result.files).toBeDefined())'],
  }
  const entry = command("schema", "success", JSON.stringify(payload))
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, {open: true, onClose() {}, load: async () => [entry]})
    await host.settle()
    const codes = host.container.querySelectorAll("code")
    expect(codes).toHaveLength(2)
    expect(codes[1]?.textContent).toBe(JSON.stringify(payload, null, 2))
    expect(JSON.parse(codes[1]!.textContent)).toEqual(JSON.parse(entry.result))
    const code = codes[1]!
    const continuation = code.querySelector('[data-line-continuation="true"]')!
    expect(continuation.textContent).toStartWith("Тот же ответ видит агент.")
    const first = code.querySelector(`[data-line-index="${continuation.getAttribute("data-line-index")}"]`)!
    expect(host.bounds(continuation).y).toBeGreaterThan(host.bounds(first).y)
    host.document.getSelection().selectAllChildren(code)
    expect(host.document.getSelection().toString()).toBe(JSON.stringify(payload, null, 2))
    const formatting = [...code.querySelectorAll("[data-formatting-characters]")]
    expect(formatting).toHaveLength(1)
    expect(formatting[0]?.textContent).toBe("\\n")
    const frame = host.renderer.flush()
    const painted = frame.displayList.filter(item => item.kind === "text" && code.contains(item.node))
    expect(painted.some(item => formatting.some(marker => marker.contains(item.node)))).toBeFalse()
    expect(painted.map(item => item.kind === "text" ? item.text : "").join("")).not.toContain("\\n")
    expect(host.container.querySelector('[data-code-language="typescript"]')).toBeNull()
  } finally {
    host.dispose()
  }
}, 15000)
