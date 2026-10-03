import {expect, test} from "bun:test"
import {normalizeMcpWindowState} from "../src/state"

test("окно MCP задаёт начальные настройки при отсутствии сохранённой сессии", () => {
  expect(normalizeMcpWindowState(undefined), "Начальное закрытое окно имеет полную геометрию и режим").toEqual({
    open: false,
    mode: "agent",
    geometry: {x: 24, y: 24, width: 620, height: 400},
  })
})

test("окно MCP проверяет повреждённые поля и прежнее сворачивание", () => {
  expect(normalizeMcpWindowState({open: true, mode: "invalid", geometry: {x: -10, y: "bad", width: 1, height: null}}),
    "Сохранённое открытие остаётся, а режим и геометрия получают допустимые значения").toEqual({
    open: true,
    mode: "agent",
    geometry: {x: 0, y: 24, width: 320, height: 400},
  })
  expect(normalizeMcpWindowState({open: true, minimized: true}).open,
    "Прежний признак сворачивания закрывает окно при восстановлении").toBeFalse()
})
