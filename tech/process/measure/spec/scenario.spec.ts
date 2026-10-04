import {describe, expect, test} from "bun:test"
import measureProcessResources from "@zavx0z/storybook-tech-process-measure"

const rows = [
  {pid: 100, parentPid: 1, cpuPercent: 12.5, rssBytes: 2097152, startedAt: "2026-09-11T08:00:00.000Z"},
  {pid: 101, parentPid: 100, cpuPercent: 3.25, rssBytes: 524288, startedAt: "2026-09-11T08:00:01.000Z"},
  {pid: 102, parentPid: 101, cpuPercent: 1, rssBytes: 262144, startedAt: "2026-09-11T08:00:02.000Z"},
  {pid: 200, parentPid: 1, cpuPercent: 99, rssBytes: 8388608, startedAt: "2026-09-11T08:00:03.000Z"},
] as const

describe.each([
  {
    name: "Корень с двумя поколениями потомков",
    props: {binding: {pid: 100, startedAt: "2026-09-11T08:00:01.250Z"}, rows},
    expected: {cpuPercent: 16.75, rssBytes: 2883584, descendantCount: 2},
  },
  {
    name: "Одиночный процесс",
    props: {binding: {pid: 200}, rows},
    expected: {cpuPercent: 99, rssBytes: 8388608, descendantCount: 0},
  },
  {
    name: "Неизвестные ресурсы потомка",
    props: {
      binding: {pid: 100},
      rows: [rows[0], {pid: 101, parentPid: 100, cpuPercent: null, rssBytes: null, startedAt: null}],
    },
    expected: {cpuPercent: null, rssBytes: null, descendantCount: 1},
  },
  {
    name: "Корень отсутствует в снимке",
    props: {binding: {pid: 300}, rows},
    expected: null,
  },
  {
    name: "PID повторно использован другим процессом",
    props: {binding: {pid: 100, startedAt: "2026-09-11T08:00:05.000Z"}, rows},
    expected: null,
  },
  {
    name: "Пустой системный снимок",
    props: {binding: {pid: 100}, rows: []},
    expected: null,
  },
])("$name", ({props, expected}) => {
  const result = measureProcessResources(props)

  test("Результат измерения", () => {
    expect(result, "Доступное дерево даёт полный ресурсный итог, отсутствие подходящего корня даёт null").toEqual(expected)
  })

  /** @remarks Поля измерения существуют только при найденном корне с подходящей меткой старта. */
  describe.skipIf(expected === null)("Доступное дерево", () => {
    test("Состав итоговых данных", () => {
      if (expected === null) throw new Error("Проверка состава применима только к доступному дереву")
      expect(result, "Ресурсный итог не раскрывает PID, команду и пути процесса").toEqual({
        cpuPercent: expected.cpuPercent,
        rssBytes: expected.rssBytes,
        descendantCount: expected.descendantCount,
      })
    })
    test("CPU", () => {
      expect(result?.cpuPercent, "Сумма %CPU относится только к корню и его потомкам; неизвестное значение сохраняется как null").toBe(expected?.cpuPercent)
    })
    test("Память", () => {
      expect(result?.rssBytes, "RSS дерева суммируется в байтах; неполное измерение не выдаётся за полный итог").toBe(expected?.rssBytes)
    })
    test("Потомки", () => {
      expect(result?.descendantCount, "Счётчик включает все найденные поколения потомков и исключает сам корень").toBe(expected?.descendantCount)
    })
    test("Неизменяемый итог", () => {
      expect(Object.isFrozen(result), "Итог относится к одному снимку и защищён от изменения").toBeTrue()
    })
  })
})
