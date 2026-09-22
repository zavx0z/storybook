import {expect, test} from "bun:test"
import {createMcpAddressSource} from "./mcp-address"

test("browser-сессия переносит запрос и публичный MCP-ответ без управляющего токена", async () => {
  const calls: {url: string, init: RequestInit | undefined}[] = []
  const response = {status: "failed", error: {code: "Error", message: "Раздел пока не доступен"}}
  const source = createMcpAddressSource(() => "/missing?view=scenarios", (async (url, init) => {
    calls.push({url: String(url), init})
    return Response.json(calls.length === 1 ? {readerToken: "reader"} : {structuredContent: response, isError: true})
  }) as typeof fetch)
  const controller = new AbortController()
  expect(source.readAddress()).toBe("/missing?view=scenarios")
  expect(await source.request({node: "missing?view=scenarios"}, controller.signal)).toEqual({result: response, failed: true})
  expect(calls.map(call => call.url)).toEqual(["/api/browser/registry-session", "/api/browser/mcp-address"])
  expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({node: "missing?view=scenarios"})
  expect(calls[1]!.init!.headers).toEqual({"content-type": "application/json", "x-storybook-session": "reader"})
  expect(calls.every(call => call.init!.signal === controller.signal)).toBeTrue()
})
