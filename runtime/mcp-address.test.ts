import {expect, test} from "bun:test"
import {createMcpAddressSource} from "./mcp-address"

test("browser-сессия переносит запрос и публичный MCP-ответ без управляющего токена", async () => {
  const calls: {url: string, init: RequestInit | undefined}[] = []
  const input = {node: "storybook/archetypes/package"}
  const response = {status: "failed", error: {code: "Error", message: "Раздел пока не доступен"}}
  const source = createMcpAddressSource(() => "/missing?view=scenarios", (async (url, init) => {
    calls.push({url: String(url), init})
    return Response.json(calls.length === 1 ? {readerToken: "reader"} : {input, structuredContent: response, isError: true})
  }) as typeof fetch)
  const controller = new AbortController()
  expect(source.readAddress()).toBe("/missing?view=scenarios")
  expect(await source.request("/missing?view=scenarios", controller.signal)).toEqual({input, result: response, failed: true})
  expect(calls.map(call => call.url)).toEqual(["/api/browser/registry-session", "/api/browser/mcp-address"])
  expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({address: "/missing?view=scenarios"})
  expect(calls[1]!.init!.headers).toEqual({"content-type": "application/json", "x-storybook-session": "reader"})
  expect(calls.every(call => call.init!.signal === controller.signal)).toBeTrue()
})
