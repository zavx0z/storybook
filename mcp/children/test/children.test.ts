import {expect, test} from "bun:test"
import {readMcpChildren} from "@mcp/children"

test("Название необязательно и не повторяет очевидный адрес или начало описания", () => {
  const entries = [
    {path: "docs", label: "Docs", description: "Документация проекта", parent: null},
    {path: "widget", label: "Кнопка", description: "Кнопка: запускает действие", parent: null},
    {path: "api", description: "Программный интерфейс", parent: null},
    {path: "input", label: "Ввод", description: "Вводный пример работы с полями", parent: null},
  ]
  const result = readMcpChildren({label: "Вход", description: "Навигация", entries})
  expect(result.label).toBe("Вход")
  expect(result.children).toEqual([
    {path: "docs", description: "Документация проекта"},
    {path: "widget", description: "Кнопка: запускает действие"},
    {path: "api", description: "Программный интерфейс"},
    {path: "input", label: "Ввод", description: "Вводный пример работы с полями"},
  ])
  expect(readMcpChildren({path: "docs", label: "DOCS", description: "Документация", entries})).not.toHaveProperty("label")
  expect(readMcpChildren({path: "api", description: "Интерфейс", entries})).not.toHaveProperty("label")
})

test("Сохраняет авторский порядок и описания, не изменяя каталог", () => {
  const entries = Object.freeze([
    Object.freeze({path: "a/second", label: "Одно название", description: "Второе назначение", parent: "a"}),
    Object.freeze({path: "a/first", label: "Одно название", description: "Первое назначение", parent: "a"}),
    Object.freeze({path: "a/first/deep", label: "Внутри", description: "Глубже", parent: "a/first"}),
    Object.freeze({path: "elsewhere", label: "Сосед", description: "Другая ветвь", parent: null}),
  ])
  const result = readMcpChildren({path: "a", label: "А", description: "Проект А", entries})
  expect(result.children).toEqual([
    {path: "a/second", label: "Одно название", description: "Второе назначение"},
    {path: "a/first", label: "Одно название", description: "Первое назначение"},
  ])
  expect(result.children[0]).not.toHaveProperty("parent")
  expect(result.children[0]).not.toBe(entries[0])
})

test("Лист и отсутствующее авторское описание остаются понятными", () => {
  const leaf = readMcpChildren({path: "leaf", label: "Компонент", description: "Назначение компонента", entries: []})
  expect(leaf).toEqual({path: "leaf", label: "Компонент", description: "Назначение компонента", children: []})
  const root = readMcpChildren({label: "Вход", description: " ", entries: [
    {path: "missing", label: "Без описания", description: "", parent: null},
  ]})
  expect(root.description).toBe("Описание не задано владельцем.")
  expect(root.children[0]?.description).toBe("Описание не задано владельцем.")
})
