import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpWindowProps} from "../index"
import {command, createWindowHost} from "../spec/fixture"

const {McpWindow} = await import("../index.tsx")

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

test("схемы показаны тем же полным JSON, который получает агент", async () => {
  const host = createWindowHost()
  const payload = {
    path: "storybook/archetypes/specs/scenarios",
    description: "Читает руководство по пути к сценарию.",
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
    expect(host.container.querySelector('[data-code-language="typescript"]')).toBeNull()
  } finally {
    host.dispose()
  }
}, 15000)
