import {expect, test} from "bun:test"
import readMcpRoot from "@mcp/root"

test("Изменение состава Repo не меняет имя Project", () => {
  const repository = {path: "other", label: "Другой Repo", description: "Авторское назначение", parent: null}
  const before = readMcpRoot({projectName: "Fixture Project", entries: []})
  const attached = readMcpRoot({projectName: "Fixture Project", entries: [repository]})
  const removed = readMcpRoot({projectName: "Fixture Project", entries: []})
  expect(attached.label).toBe(before.label)
  expect(attached.description).toBe(before.description)
  expect(attached.children).toEqual([{path: "other", label: "Другой Repo", description: "Авторское назначение"}])
  expect(removed).toEqual(before)
  expect(Object.keys(before)).toEqual(["description", "label", "children"])
  expect(removed).not.toHaveProperty("path")
})


test("Имя Project меняется независимо от адресов его Repo", () => {
  const entries = [{path: "repo", description: "Repo", parent: null}]
  const before = readMcpRoot({projectName: "First Project", entries})
  const after = readMcpRoot({projectName: "Renamed Project", entries})
  expect(before.label).toBe("First Project")
  expect(after.label).toBe("Renamed Project")
  expect(after.children).toEqual(before.children)
})
