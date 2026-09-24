import {expect, test} from "bun:test"
import {createNavigationExpansion} from "./persistence.ts"

test("свёрнутые ветви восстанавливаются после нового запуска, остальные настройки сохраняются", () => {
  const values = new Map<string, string>([["storybook.mcp-window.v1", "window-state"]])
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
  const first = createNavigationExpansion(storage)
  expect(first.initialCollapsedIds).toEqual([])
  first.save(["package:@zavx0z/storybook", "category:specs", "package:@zavx0z/storybook"])
  const restored = createNavigationExpansion(storage)
  expect(restored.initialCollapsedIds).toEqual(["package:@zavx0z/storybook", "category:specs"])
  expect(values.get("storybook.mcp-window.v1")).toBe("window-state")
  restored.save([])
  expect(createNavigationExpansion(storage).initialCollapsedIds).toEqual([])
})

test("неправильное или недоступное хранилище оставляет дерево открытым", () => {
  const broken = {getItem: () => '{"version":1,"collapsedIds":"wrong"}', setItem: () => {}}
  expect(createNavigationExpansion(() => broken).initialCollapsedIds).toEqual([])
  const unavailable = createNavigationExpansion(() => { throw new Error("storage unavailable") })
  expect(unavailable.initialCollapsedIds).toEqual([])
  expect(() => unavailable.save(["package:example"])).not.toThrow()
})
