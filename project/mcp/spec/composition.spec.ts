import {expect, test} from "bun:test"
import readProjectMcp from "@zavx0z/storybook-project-mcp"

test("Изменение состава Repo не меняет имя Project", () => {
  const repository = {path: "other", label: "Другой Repo", description: "Авторское назначение", parent: null}
  const before = readProjectMcp({projectName: "Fixture Project", entries: []})
  const attached = readProjectMcp({projectName: "Fixture Project", entries: [repository]})
  const removed = readProjectMcp({projectName: "Fixture Project", entries: []})
  expect(attached.label, "Добавление Repo сохраняет идентичность Project").toBe(before.label)
  expect(attached.description, "Назначение входа Project сохраняется при изменении состава").toBe(before.description)
  expect(attached.children, "Новый Repo раскрывается со своими адресом и назначением")
    .toEqual([{path: "./other", label: "Другой Repo", description: "Авторское назначение"}])
  expect(removed, "Исключённый Repo не сохраняется в скрытом состоянии").toEqual(before)
  expect(Object.keys(before), "Порядок полей корня сохраняется при смене владельца")
    .toEqual(["description", "path", "label", "children"])
  expect(removed.path, "Адрес root остаётся точкой при опустошении состава").toBe(".")
})

test("Имя Project меняется независимо от адресов его Repo", () => {
  const entries = [{path: "repo", description: "Repo", parent: null}]
  const before = readProjectMcp({projectName: "First Project", entries})
  const after = readProjectMcp({projectName: "Renamed Project", entries})
  expect(before.label, "Первое чтение сохраняет прежнее имя").toBe("First Project")
  expect(after.label, "Следующее чтение использует переданное новое имя").toBe("Renamed Project")
  expect(after.children, "Переименование Project не переписывает адреса Repo").toEqual(before.children)
})
