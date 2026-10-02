import {describe, expect, test} from "bun:test"
import defaultMcpWindowState from "@mcp-window/state"

describe.each([{name: "Начальные настройки окна MCP", props: {}}])("$name", () => {
  const actual = defaultMcpWindowState()

  test("Закрытое окно до первого сохранения", () => {
    expect(actual, "Окно MCP начинается закрытым в режиме агента с собственной геометрией")
      .toEqual({open: false, mode: "agent", geometry: {x: 24, y: 24, width: 620, height: 400}})
  })

  test("Независимость нового состояния", () => {
    const first = defaultMcpWindowState()
    first.open = true
    first.mode = "address"
    first.geometry.x = 100
    const next = defaultMcpWindowState()
    expect(next, "Каждый вызов возвращает отдельное состояние").not.toBe(first)
    expect(next.geometry, "Геометрия также принадлежит одному вызову").not.toBe(first.geometry)
    expect(next, "Изменение предыдущего результата не меняет начальные настройки нового")
      .toEqual({open: false, mode: "agent", geometry: {x: 24, y: 24, width: 620, height: 400}})
  })
})
