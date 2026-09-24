import {expect, test} from "bun:test"
import {readMcpRoot} from "@mcp/root"

test("Добавление и удаление проектов не меняет назначение Root", () => {
  const project = {path: "other", label: "Другой проект", description: "Авторское назначение", parent: null}
  const before = readMcpRoot({entries: []})
  const attached = readMcpRoot({entries: [project]})
  const removed = readMcpRoot({entries: []})
  expect(attached.label).toBe(before.label)
  expect(attached.description).toBe(before.description)
  expect(attached.children).toEqual([{path: "other", label: "Другой проект", description: "Авторское назначение"}])
  expect(removed).toEqual(before)
  expect(Object.keys(before)).toEqual(["label", "description", "children"])
  expect(removed).not.toHaveProperty("path")
})
