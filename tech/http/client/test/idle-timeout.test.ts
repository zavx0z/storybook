import {expect, test} from "bun:test"
import Client from "@zavx0z/storybook-tech-http-client"

test("пауза долгой операции сохраняет ожидание до переданного срока", async () => {
  const nativeFetch = globalThis.fetch
  // Короткий socket deadline воспроизводит независимый native таймер без ожидания пяти минут.
  globalThis.fetch = Object.assign((input: Parameters<typeof nativeFetch>[0], init?: BunFetchRequestInit) =>
    nativeFetch(input, {timeout: 10, ...init}), {preconnect: nativeFetch.preconnect})
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch() {
      await Bun.sleep(9000)
      return Response.json({ok: true})
    },
  })
  try {
    const client = new Client({origin: server.url.origin, instanceId: "fixture", authorization: () => "fixture"})
    const [ordinary, controlled] = await Promise.allSettled([
      fetch(server.url, {signal: AbortSignal.timeout(15000)}).then(response => response.json()),
      client.controlStream("/api/control/check", {}, undefined, AbortSignal.timeout(15000)),
    ])
    expect(ordinary.status, "Контрольный native запрос действительно исчерпал socket idle deadline").toBe("rejected")
    if (ordinary.status === "rejected") expect(ordinary.reason.name).toBe("TimeoutError")
    expect(controlled, "Управляющее ожидание ограничено своим signal и получает поздний результат").toEqual({status: "fulfilled", value: {ok: true}})
  } finally {
    globalThis.fetch = nativeFetch
    server.stop(true)
  }
}, 20000)
