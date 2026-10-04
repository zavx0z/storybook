/** Управляющий клиент передаёт авторизованный запрос одному loopback instance. */
import {afterAll, describe, expect, test} from "bun:test"
import StorybookTechHttpClient from "@zavx0z/storybook-tech-http-client"

describe.each([
  {name: "Чтение состояния", props: {method: "GET" as const, path: "/api/status", body: undefined}},
  {name: "Явная команда", props: {method: "POST" as const, path: "/api/check", body: {live: false}}},
])("$name", async ({props}) => {
  const requests: {method: string; path: string; authorization: string | null; body: unknown}[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        body: request.method === "POST" ? await request.json() : null,
      })
      return Response.json({status: "ready"})
    },
  })
  afterAll(() => server.stop(true))
  const client = new StorybookTechHttpClient({
    origin: server.url.origin,
    instanceId: "fixture-instance",
    authorization: () => "Bearer fixture-secret",
  })
  const result = props.method === "GET"
    ? await client.read(props.path)
    : await client.control(props.path, props.body)

  test("Результат", () => {
    expect(result, "JSON ответ локального управляющего сервиса возвращается вызывающему владельцу").toEqual({status: "ready"})
  })
  test("Доставка", () => {
    expect(requests, "Клиент направляет exact API path, метод и bearer capability связанному instance").toEqual([{
      method: props.method,
      path: props.path,
      authorization: "Bearer fixture-secret",
      body: props.body ?? null,
    }])
  })
})
