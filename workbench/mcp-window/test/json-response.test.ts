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
