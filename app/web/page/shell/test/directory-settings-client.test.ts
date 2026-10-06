import {expect, test} from "bun:test"
import {createDirectorySettingsClient} from "../src/directory-settings-client"

test("читает текущие каталоги и сохраняет оба пути через browser session", async () => {
  const calls: {url: string, init: RequestInit | undefined}[] = []
  const fetcher = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(url), init})
    return Response.json(init?.method === "POST"
      ? {repositoriesDirectory: "/work/repos", projectsDirectory: "/work/projects"}
      : {repositoriesDirectory: "/old/repos", projectsDirectory: null})
  }, {preconnect() {}})
  const client = createDirectorySettingsClient(fetcher, () => "browser-grant")
  const signal = new AbortController().signal
  expect(await client.read(signal)).toEqual({repositoriesDirectory: "/old/repos", projectsDirectory: null})
  expect(await client.save({repositoriesDirectory: "~/repos", projectsDirectory: "~/projects"}, signal))
    .toEqual({repositoriesDirectory: "/work/repos", projectsDirectory: "/work/projects"})
  expect(calls.map(call => call.url)).toEqual(["/api/browser/settings", "/api/browser/settings"])
  expect(calls[0]!.init?.method).toBe("GET")
  expect(calls[1]!.init?.method).toBe("POST")
  expect(new Headers(calls[1]!.init?.headers).get("x-storybook-session")).toBe("browser-grant")
  expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({repositoriesDirectory: "~/repos", projectsDirectory: "~/projects"})
  expect(calls[1]!.init?.signal).toBe(signal)
})

test("получает browser grant при отсутствии meta session и не сохраняет grant в документ", async () => {
  const calls: {url: string, init: RequestInit | undefined}[] = []
  const fetcher = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(url), init})
    return Response.json(String(url).endsWith("registry-session")
      ? {readerToken: "issued-grant"}
      : {repositoriesDirectory: "/repos", projectsDirectory: "/projects"})
  }, {preconnect() {}})
  const client = createDirectorySettingsClient(fetcher, () => undefined)
  await client.save({repositoriesDirectory: "/repos", projectsDirectory: "/projects"}, new AbortController().signal)
  expect(calls.map(call => call.url)).toEqual(["/api/browser/registry-session", "/api/browser/settings"])
  expect(new Headers(calls[1]!.init?.headers).get("x-storybook-session")).toBe("issued-grant")
  expect(String(calls[1]!.init?.body)).not.toContain("issued-grant")
})

test("сохраняет серверную причину отказа, неполный ответ не выдаёт за сохранение", async () => {
  let attempts = 0
  const fetcher = Object.assign(async () => {
    attempts++
    return attempts === 1 ? Response.json({error: "Каталоги должны различаться"}, {status: 400})
      : Response.json({repositoriesDirectory: "/repos", projectsDirectory: null})
  }, {preconnect() {}})
  const client = createDirectorySettingsClient(fetcher, () => "grant")
  const draft = {repositoriesDirectory: "/repos", projectsDirectory: "/projects"}
  const signal = new AbortController().signal
  await expect(client.save(draft, signal)).rejects.toThrow("Каталоги должны различаться")
  await expect(client.save(draft, signal)).rejects.toThrow("Сервер не подтвердил сохранение обоих каталогов")
})

test("отменённая страница не начинает запрос настроек", async () => {
  let calls = 0
  const fetcher = Object.assign(async () => {calls++; return Response.json({})}, {preconnect() {}})
  const controller = new AbortController()
  controller.abort()
  await expect(createDirectorySettingsClient(fetcher, () => "grant").read(controller.signal)).rejects.toThrow()
  expect(calls).toBe(0)
})
