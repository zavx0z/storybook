import {describe, expect, test} from "bun:test"
import measureProcessResources from "@storybook-tech-process/measure"

describe("Ресурсы точного дерева процессов", () => {
  test("aggregates only the bound worker tree and rejects a reused PID", () => {
    const rows = [
      {pid: 100, parentPid: 1, cpuPercent: 12.5, rssBytes: 2097152, startedAt: "2026-09-11T08:00:00.000Z"},
      {pid: 101, parentPid: 100, cpuPercent: 3.25, rssBytes: 524288, startedAt: "2026-09-11T08:00:01.000Z"},
      {pid: 102, parentPid: 101, cpuPercent: 1, rssBytes: 262144, startedAt: "2026-09-11T08:00:02.000Z"},
      {pid: 200, parentPid: 1, cpuPercent: 99, rssBytes: 8388608, startedAt: "2026-09-11T08:00:03.000Z"},
    ]
    expect(measureProcessResources({binding: {
      pid: 100,
      startedAt: "2026-09-11T08:00:01.250Z",
    }, rows})).toEqual({
      cpuPercent: 16.75,
      rssBytes: 2_883_584,
      descendantCount: 2,
    })
    expect(measureProcessResources({binding: {
      pid: 100,
      startedAt: "2026-09-11T08:00:05.000Z",
    }, rows})).toBeNull()
  })

  test("does not report a partial aggregate as measured total", () => {
    const rows = [
      {pid: 100, parentPid: 1, cpuPercent: 12.5, rssBytes: 2097152, startedAt: "2026-09-11T08:00:00.000Z"},
      {pid: 101, parentPid: 100, cpuPercent: null, rssBytes: null, startedAt: "2026-09-11T08:00:01.000Z"},
    ]
    expect(measureProcessResources({binding: {pid: 100}, rows})).toEqual({
      cpuPercent: null,
      rssBytes: null,
      descendantCount: 1,
    })
  })
})
