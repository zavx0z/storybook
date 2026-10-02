import {describe, expect, test} from "bun:test"
import defaultMinimapState from "@minimap/state"

describe.each([{name: "Начальные настройки Minimap", props: {}}])("$name", () => {
  const actual = defaultMinimapState()

  test("Раскладка до первого сохранения", () => {
    expect(actual, "Minimap начинается раскрытым с собственной геометрией и вкладкой слева")
      .toEqual({collapsed: false, geometry: {x: 8, y: 8, width: 300, height: 480}, tab: {edge: "left", offset: .5}})
  })

  test("Независимость нового состояния", () => {
    const first = defaultMinimapState()
    Object.assign(first.geometry, {x: 100})
    Object.assign(first.tab, {offset: .75})
    const next = defaultMinimapState()
    expect(next, "Каждый вызов возвращает отдельное состояние").not.toBe(first)
    expect(next.geometry, "Геометрия также принадлежит одному вызову").not.toBe(first.geometry)
    expect(next.tab, "Положение вкладки также принадлежит одному вызову").not.toBe(first.tab)
    expect(next, "Изменение предыдущего результата не меняет начальные настройки нового")
      .toEqual({collapsed: false, geometry: {x: 8, y: 8, width: 300, height: 480}, tab: {edge: "left", offset: .5}})
  })
})
