import {expect, test} from "bun:test"
import createLazyMcpServer from "@zavx0z/storybook-tech-mcp-lazy"

test.each([0, -1, Infinity, NaN])("отклоняет некорректный явный срок клиента: %s", timeoutMs => {
  expect(() => createLazyMcpServer({
    serverModule: "/fixture/server.ts",
    cwd: "/fixture",
    temporaryRoot: "/fixture/jobs",
    timeoutMs,
  })).toThrow(RangeError)
})
