import {describe, expect, test} from "bun:test"
import {
  measureStorybookWorkerResources,
  parseStorybookProcessResourceRows,
} from "./resource-usage.ts"

describe("Storybook worker resource snapshots", () => {
  test("parses BSD ps CPU and converts RSS KiB to bytes", () => {
    const rows = parseStorybookProcessResourceRows([
      " 100 1 12.5 2048 Thu Sep 11 08:00:00 2026",
      " 101 100 3.25 512 Thu Sep 11 08:00:01 2026",
      " malformed",
      " 102 100 - ? Thu Sep 11 08:00:02 2026",
    ].join("\n"))
    expect(rows).toEqual([
      {
        pid: 100,
        parentPid: 1,
        cpuPercent: 12.5,
        rssBytes: 2_097_152,
        startedAt: "2026-09-11T08:00:00.000Z",
      },
      {
        pid: 101,
        parentPid: 100,
        cpuPercent: 3.25,
        rssBytes: 524_288,
        startedAt: "2026-09-11T08:00:01.000Z",
      },
      {
        pid: 102,
        parentPid: 100,
        cpuPercent: null,
        rssBytes: null,
        startedAt: "2026-09-11T08:00:02.000Z",
      },
    ])
  })

  test("aggregates only the bound worker tree and rejects a reused PID", () => {
    const rows = parseStorybookProcessResourceRows([
      " 100 1 12.5 2048 Thu Sep 11 08:00:00 2026",
      " 101 100 3.25 512 Thu Sep 11 08:00:01 2026",
      " 102 101 1.0 256 Thu Sep 11 08:00:02 2026",
      " 200 1 99.0 8192 Thu Sep 11 08:00:03 2026",
    ].join("\n"))
    expect(measureStorybookWorkerResources({
      pid: 100,
      startedAt: "2026-09-11T08:00:01.250Z",
    }, rows)).toEqual({
      cpuPercent: 16.75,
      rssBytes: 2_883_584,
      descendantCount: 2,
    })
    expect(measureStorybookWorkerResources({
      pid: 100,
      startedAt: "2026-09-11T08:00:05.000Z",
    }, rows)).toBeNull()
  })

  test("does not report a partial aggregate as measured total", () => {
    const rows = parseStorybookProcessResourceRows([
      " 100 1 12.5 2048 Thu Sep 11 08:00:00 2026",
      " 101 100 - ? Thu Sep 11 08:00:01 2026",
    ].join("\n"))
    expect(measureStorybookWorkerResources({pid: 100}, rows)).toEqual({
      cpuPercent: null,
      rssBytes: null,
      descendantCount: 1,
    })
  })
})
