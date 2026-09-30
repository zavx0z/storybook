import {describe, expect, test} from "bun:test"
import parseProcessResourceRows from "../src/parse-rows"

describe("Системные строки процессов", () => {
  test("parses BSD ps CPU and converts RSS KiB to bytes", () => {
    const rows = parseProcessResourceRows([
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

})
