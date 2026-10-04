import {expect, test} from "bun:test"
import {createLocalMcpState} from "../src/local-mcp-state"
import {createMcpWindowPersistence} from "../src/mcp-window-persistence"
import {createMcpRequestSource} from "../src/mcp-requests"

test("локальные окна восстанавливаются независимо от адреса соседа и глобального окна", () => {
  const values = new Map<string, string>()
  const storage = () => ({getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }})
  const local = createLocalMcpState(storage, "/a")
  expect(local.getSnapshot().state).toBeUndefined()
  const state = {open: true, mode: "address" as const, geometry: {x: 55, y: 44, width: 600, height: 300}}
  local.save("/a", state)
  local.select("/b")
  expect(local.getSnapshot().state).toBeUndefined()
  local.setOpen(false)
  local.select("/a")
  expect(local.getSnapshot().state).toEqual(state)
  const global = createMcpWindowPersistence(storage, "storybook.mcp-window.global.v1")
  expect(global.initialState).toBeUndefined()
  global.save({open: false, geometry: {x: 11, y: 12}})
  expect(createLocalMcpState(storage, "/a").getSnapshot().state).toEqual(state)
  expect(createLocalMcpState(storage, "/a", local.capture()).getSnapshot().state).toEqual(state)
  expect(createMcpWindowPersistence(storage, "storybook.mcp-window.global.v1").initialState?.open).toBe(false)
})

test("запрос локального журнала передаёт адрес источника, общий запрос не содержит фильтра", async () => {
  const urls: string[] = []
  const fetcher = Object.assign(async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return Response.json(String(input).endsWith("registry-session") ? {readerToken: "reader"} : {entries: []})
  }, {preconnect: fetch.preconnect})
  const load = createMcpRequestSource(fetcher)
  await load()
  await load("/storybook/package")
  expect(urls).toEqual(["/api/browser/registry-session", "/api/browser/mcp-requests",
    "/api/browser/registry-session", "/api/browser/mcp-requests?address=%2Fstorybook%2Fpackage"])
})
