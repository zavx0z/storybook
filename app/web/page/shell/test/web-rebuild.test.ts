import {expect, test} from "bun:test"
import {createWebRebuildAction} from "../src/web-rebuild.ts"

test("явная пересборка Web использует browser-сессию и одну операцию приложения", async () => {
  const requests: {url: string, init: RequestInit | undefined}[] = []
  const rebuild = createWebRebuildAction((async (url, init) => {
    requests.push({url: String(url), init})
    return Response.json(requests.length === 1 ? {readerToken: "browser-session"} : {ok: true})
  }))
  await rebuild()
  expect(requests.map(request => request.url)).toEqual([
    "/api/browser/registry-session",
    "/api/browser/app/web/rebuild",
  ])
  expect(requests[1]!.init).toEqual({
    method: "POST",
    headers: {"content-type": "application/json", "x-storybook-session": "browser-session"},
    body: "{}",
  })
})

test.each([
  {status: 500, result: {error: "Ошибка подготовки Web"}, message: "Ошибка подготовки Web"},
  {status: 200, result: {ok: false, error: "Среда несовместима"}, message: "Среда несовместима"},
  {status: 409, result: {error: {message: "Нужна другая среда"}}, message: "Нужна другая среда"},
  {status: 503, result: {}, message: "Не удалось пересобрать интерфейс: HTTP 503"},
])("ошибка операции доступна кнопке: $message", async ({status, result, message}) => {
  let request = 0
  const rebuild = createWebRebuildAction((async () => {
    request += 1
    return request === 1 ? Response.json({readerToken: "browser-session"}) : Response.json(result, {status})
  }))
  await expect(rebuild()).rejects.toThrow(message)
  expect(request).toBe(2)
})

test.each([undefined, "", 42])("невалидная browser-сессия не запускает пересборку: %p", async readerToken => {
  let request = 0
  const rebuild = createWebRebuildAction((async () => {
    request += 1
    return Response.json({readerToken})
  }))
  await expect(rebuild()).rejects.toThrow("Нет сессии Storybook для пересборки интерфейса")
  expect(request).toBe(1)
})

test("отказ выдачи browser-сессии не запускает операцию приложения", async () => {
  let request = 0
  const rebuild = createWebRebuildAction((async () => {
    request += 1
    return Response.json({error: "Недоступно"}, {status: 503})
  }))
  await expect(rebuild()).rejects.toThrow("Не удалось открыть сессию пересборки интерфейса")
  expect(request).toBe(1)
})
