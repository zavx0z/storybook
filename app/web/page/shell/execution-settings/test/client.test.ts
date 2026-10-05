import {expect, test} from "bun:test"
import {createSettingsClient} from "../src/client"
import {windowState} from "../src/state"

test("переключение вкладок разделяет один запрос каталога и ограниченный кэш окна", async () => {
  const response = Promise.withResolvers<void>()
  let probes = 0
  const client = createSettingsClient(Object.assign(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("registry-session")) return Response.json({readerToken: "test"})
    probes++
    await response.promise
    return Response.json([{id: "model", category: "model", name: "Модель", value: "a", options: [{value: "a", name: "A"}]}])
  }, {preconnect() {}}), new AbortController().signal)
  const first = client.options("codex")
  const second = client.options("codex")
  response.resolve()
  expect(await first).toEqual(await second)
  await client.options("codex")
  expect(probes).toBe(1)
})

test("ошибка каталога допускает повтор, закрытое окно не запускает следующий запрос", async () => {
  let calls = 0
  const controller = new AbortController()
  const client = createSettingsClient(Object.assign(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("registry-session")) return Response.json({readerToken: "test"})
    calls++
    return calls === 1 ? Response.json({error: "Повторите загрузку"}, {status: 400}) : Response.json([])
  }, {preconnect() {}}), controller.signal)
  await expect(client.options("codex")).rejects.toThrow("Повторите")
  expect(await client.options("codex")).toEqual([])
  controller.abort()
  expect(() => client.options("codex", "other")).toThrow()
  expect(calls).toBe(2)
})

test("положение окна восстанавливается без переноса провайдерских данных", () => {
  const saved = {open: true, geometry: {x: 320, y: 60, width: 900, height: 700}, tab: {edge: "right" as const, offset: .3}}
  expect(windowState(saved)).toEqual(saved)
  expect(windowState({geometry: {x: NaN, y: -9, width: 2, height: Infinity}}).geometry).toEqual({x: 80, y: 0, width: 340, height: 580})
})
