import {expect, test} from "bun:test"
import createLazyMcpServer from "@mcp/lazy"

test.each([0, -1, Infinity, NaN, 900_001])("не обещает запросу недоступный бюджет: %s", timeoutMs => {
  expect(() => createLazyMcpServer({
    serverModule: "/fixture/server.ts",
    cwd: "/fixture",
    temporaryRoot: "/fixture/jobs",
    timeoutMs,
  })).toThrow(RangeError)
})
