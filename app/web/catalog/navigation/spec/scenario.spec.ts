import {expect, test} from "bun:test"
import Navigation from "../index"

test("дубли и противоречивые группы отклоняются до изменения входного каталога", () => {
  const items = [
    {id: "interfaces", label: "Интерфейсы", route: "dom/interfaces"},
    {id: "primitives", label: "Примитивы", route: "elements/primitives", group: {id: "elements", label: "Элементы"}},
    {id: "styles", label: "Стили", route: "elements/style", group: {id: "elements", label: "Элементы"}},
  ]
  expect(() => Navigation.normalizeItems("Catalog", [items[0]!, items[0]!]))
    .toThrow("Duplicate catalog item id: interfaces")
  expect(() => Navigation.normalizeItems("Catalog", [
    items[1]!,
    {...items[2]!, group: {id: "elements", label: "Другие элементы"}},
  ])).toThrow("Conflicting catalog group label for id: elements")
  expect(items[2]!.group!.label).toBe("Элементы")
})

test("группа и выбираемый лист могут иметь одинаковый идентификатор", () => {
  const items = Navigation.normalizeItems("Catalog", [{
    id: "text",
    label: "Text",
    route: "text",
    group: {id: "text", label: "Text group"},
  }])
  const projection = Navigation.projectNavigation(items, "", new Set())
  expect(projection.rows.map(row => [row.kind, row.id])).toEqual([
    ["group", "text"],
    ["leaf", "text"],
  ])
})

test("родительские связи проверяются независимо от порядка узлов", () => {
  const items = Navigation.normalizeItems("Catalog", [
    {id: "child", parentId: "root", label: "Часть", route: "/root/child"},
    {id: "root", label: "Корень", route: "/root"},
  ])
  expect(Navigation.projectNavigation(items, "", new Set()).rows.map(row => row.id))
    .toEqual(["root", "child"])
  expect(() => Navigation.normalizeItems("Catalog", [
    {id: "child", parentId: "missing", label: "Часть", route: "/child"},
  ])).toThrow("Unknown Catalog parent: missing")
  expect(() => Navigation.normalizeItems("Catalog", [
    {id: "root", parentId: "child", label: "Корень", route: "/root"},
    {id: "child", parentId: "root", label: "Часть", route: "/child"},
  ])).toThrow("Cyclic Catalog navigation")
})

test("поиск сохраняет предков совпадений и не раскрывает закрытую ветвь", () => {
  const items = Navigation.normalizeItems("Catalog", [
    {id: "root", label: "Компоненты", route: "/components"},
    {id: "button", parentId: "root", label: "button", title: "Кнопка", route: "/components/button"},
    {id: "tab", parentId: "root", label: "tab", route: "/components/tab"},
  ])
  const collapsed = new Set(["root"])
  expect(Navigation.projectNavigation(items, " КНОПКА ", new Set()).rows.map(row => row.id))
    .toEqual(["root", "button"])
  expect(Navigation.projectNavigation(items, "Кнопка", collapsed).rows.map(row => row.id))
    .toEqual(["root"])
  expect([...collapsed]).toEqual(["root"])
  expect(items.map(item => item.id)).toEqual(["root", "button", "tab"])
})
