import {expect, test} from "bun:test"
import {normalizeMinimapState} from "../src/state"

test("Minimap задаёт начальную раскладку при отсутствии сохранённых настроек", () => {
  expect(normalizeMinimapState(undefined), "Раскладка принадлежит компоненту и содержит полное состояние").toEqual({
    collapsed: false,
    geometry: {x: 8, y: 8, width: 300, height: 480},
    tab: {edge: "left", offset: .5},
  })
})

test("Minimap исправляет повреждённые поля без потери корректных настроек", () => {
  expect(normalizeMinimapState({collapsed: true, geometry: {x: -10, y: "bad", width: 0, height: 200}, tab: {edge: "invalid", offset: 2}}),
    "Сохранённые видимость и высота применяются, прочие поля получают допустимые значения").toEqual({
    collapsed: true,
    geometry: {x: 0, y: 8, width: 300, height: 200},
    tab: {edge: "left", offset: 1},
  })
})
