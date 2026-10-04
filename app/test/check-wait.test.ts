import StorybookAppOwner from "@zavx0z/storybook-app"
const createExternalStorybookController = StorybookAppOwner
import ServerState from "@zavx0z/storybook-app-server-state"
const {createExternalStorybookServerRecord, externalStorybookServerStatePath, writeExternalStorybookServerRecord} = ServerState
import {expect, spyOn, test} from "bun:test"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test.each([
  {name: "Обычный JSON", streamed: false},
  {name: "Поток стадий", streamed: true},
])("check принимает $name через один управляющий transport", async ({streamed}) => {
  const fixture = createLazyStartupFixture()
  const stateRoot = fixture.stateRoot
  const previous = Bun.env.STORYBOOK_STATE_ROOT
  const previousCwd = process.cwd()
  Bun.env.STORYBOOK_STATE_ROOT = stateRoot
  process.chdir(fixture.toolRoot)
  const accepts: (string | null)[] = []
  const progress: Readonly<Record<string, unknown>>[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/api/control/status") return Response.json({packages: []})
      if (path === "/api/control/check") {
        accepts.push(request.headers.get("accept"))
        if (streamed) return new Response(
          `${JSON.stringify({type: "progress", progress: {phase: "compile"}})}\n${JSON.stringify({type: "result", result: {ok: true, packages: []}})}\n`,
          {headers: {"content-type": "application/x-ndjson"}},
        )
        return Response.json({ok: true, packages: []})
      }
      return Response.json({ok: true})
    },
  })
  try {
    const record = createExternalStorybookServerRecord({
      toolRoot: fixture.toolRoot,
      origin: server.url.origin,

      attachedDeclarations: [],
    })
    writeExternalStorybookServerRecord(externalStorybookServerStatePath(), record)
    const controller = createExternalStorybookController({toolRoot: fixture.toolRoot, legacyStatePaths: []})
    const signal = new AbortController().signal
    let observedSignal: AbortSignal | null | undefined
    const nativeFetch = globalThis.fetch
    const observedFetch = Object.assign((...args: Parameters<typeof fetch>) => {
      const [input, init] = args
      if (input instanceof URL && input.pathname === "/api/control/check") observedSignal = init?.signal
      return nativeFetch(...args)
    }, {preconnect: nativeFetch.preconnect})
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(observedFetch)
    let result: Awaited<ReturnType<typeof controller.check>>
    try {
      result = await controller.check({schemaVersion: 1, scope: "storybook:shared"}, {
        signal,
        onProgress: stage => { progress.push(stage) },
      })
      expect(observedSignal, "Без timeoutMs HTTP получает исходный signal, без скрытого таймера").toBe(signal)
    } finally { fetchSpy.mockRestore() }
    expect(result, "JSON и NDJSON возвращают одинаковый успешный предметный результат").toMatchObject({status: "success", ok: true})
    expect(accepts, "Долгая проверка выбирает transport с поддержкой progress и JSON fallback").toEqual(["application/x-ndjson"])
    expect(progress, "Фактические стадии доставляются только из NDJSON ответа").toEqual(streamed ? [{phase: "compile"}] : [])
  } finally {
    server.stop(true)
    if (previous === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previous
    process.chdir(previousCwd)
    fixture.dispose()
  }
}, 10_000)


test.each(["storybook:web", "storybook:shared", "@fixture/component"])("%s ждёт результат по событиям и сохраняет доступность status", async scope => {
  const fixture = createLazyStartupFixture()
  const previous = Bun.env.STORYBOOK_STATE_ROOT
  const cwd = process.cwd()
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  process.chdir(fixture.toolRoot)
  const finish = Promise.withResolvers<void>()
  const progressSeen = Promise.withResolvers<void>()
  const cancellation = new AbortController()
  let checks = 0
  let completed = false
  const bodies: unknown[] = []
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request, server) {
    const path = new URL(request.url).pathname
    if (path === "/api/control/check" || path === "/api/control/app/web/rebuild") {
      server.timeout(request, 0)
      checks += 1
      bodies.push(await request.json())
      const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + "\n")
      return new Response(new ReadableStream({async start(controller) {
        controller.enqueue(encode({type: "progress", progress: {phase: "host"}}))
        await finish.promise
        controller.enqueue(encode({type: "result", result: {ok: true, published: true, applied: true, packages: [], views: []}}))
        controller.close()
      }}), {headers: {"content-type": "application/x-ndjson"}})
    }
    if (path === "/api/control/status") return Response.json({packages: [], preflight: {packageIds: []}, buildScheduler: {activeCount: 1}})
    return Response.json({ok: true})
  }})
  try {
    const record = createExternalStorybookServerRecord({toolRoot: fixture.toolRoot, origin: server.url.origin})
    writeExternalStorybookServerRecord(externalStorybookServerStatePath(), record)
    const controller = createExternalStorybookController({toolRoot: fixture.toolRoot, legacyStatePaths: []})
    const pending = controller.check({schemaVersion: 1, scope}, {signal: cancellation.signal,
      onProgress: () => { progressSeen.resolve() },
    }).then(result => {
      completed = true
      return result
    })
    await progressSeen.promise
    expect(completed).toBeFalse()
    expect((await controller.status({schemaVersion: 1, scope}, {signal: cancellation.signal})).server).toBe("running")
    expect(checks).toBe(1)
    expect(bodies).toEqual(scope === "storybook:web" ? [{}] : [{scope}])
    finish.resolve()
    expect(await pending).toMatchObject({status: "success", ok: true, applied: true})
    cancellation.abort(new Error("external cancellation"))
    await expect(controller.check({schemaVersion: 1, scope}, {signal: cancellation.signal})).rejects.toThrow("external cancellation")
    expect(checks).toBe(1)
  } finally {
    finish.resolve()
    await server.stop(true)
    if (previous === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previous
    process.chdir(cwd)
    fixture.dispose()
  }
}, 10000)
