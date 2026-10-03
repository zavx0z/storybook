import StorybookAppOwner from "@storybook/app"
const createExternalStorybookController = StorybookAppOwner
import ServerState from "@app-server/state"
const {createExternalStorybookServerRecord, externalStorybookServerStatePath, writeExternalStorybookServerRecord} = ServerState
import {expect, test} from "bun:test"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test.each(["compiling", "failed", "old-failed"])("таймаут ожидания сохраняет актуальное состояние %s без повторного check", async buildState => {
  const fixture = createLazyStartupFixture()
  const stateRoot = fixture.stateRoot
  const previous = Bun.env.STORYBOOK_STATE_ROOT
  const previousCwd = process.cwd()
  Bun.env.STORYBOOK_STATE_ROOT = stateRoot
  process.chdir(fixture.toolRoot)
  let checks = 0
  let legacyStatus = false
  const viewsQueries: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/api/control/check") {
        checks += 1
        await new Promise<void>(resolve => {
          if (request.signal.aborted) resolve()
          else request.signal.addEventListener("abort", () => resolve(), {once: true})
        })
        return new Response(null, {status: 499})
      }
      if (path === "/api/control/status") return Response.json({
        packages: [{
          packageId: "@fixture/pending",
          buildState: checks === 0 ? buildState === "old-failed" ? "failed" : "idle" : buildState === "old-failed" ? "failed" : buildState,
          generation: buildState === "old-failed" || checks === 0 ? 1 : 2,
          failedRevision: buildState === "old-failed" ? "previous-failure" : checks > 0 && buildState === "failed" ? "new-failure" : null,
          pendingOperationId: "owned-operation", builds: 1,
        }],
        ...(legacyStatus ? {} : {preflight: {packageIds: ["@fixture/pending"]}}),
        buildScheduler: {activeCount: 1, queuedCount: 0},
        discovery: {refreshing: buildState === "old-failed"},
      })
      if (path === "/api/control/views") {
        viewsQueries.push(new URL(request.url).search)
        return Response.json({views: [{packageId: "@fixture/pending"}, {packageId: "@fixture/other"}]})
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
    const result = await controller.check({schemaVersion: 1, scope: "@fixture/pending", timeoutMs: 300}, {
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject(buildState === "old-failed"
      ? {status: "timeout", waitingOnly: true, inProgress: true, checkResultKnown: false}
      : buildState === "compiling"
      ? {status: "timeout", waitingOnly: true, inProgress: true, operationIds: ["owned-operation"]}
      : {status: "failed", waitingOnly: false, inProgress: false, operationIds: []})
    expect(result.buildScheduler).toMatchObject({activeCount: 1, queuedCount: 0})
    expect(checks).toBe(1)
    if (buildState === "compiling") {
      writeExternalStorybookServerRecord(externalStorybookServerStatePath(), {...record})
      legacyStatus = true
      const legacy = await controller.status({schemaVersion: 1, scope: "/fixture/project", includeViews: true}, {signal: new AbortController().signal})
      expect(legacy).toMatchObject({server: "running", scopeProjection: "unavailable"})
      expect(legacy.packages).toHaveLength(1)
      expect(legacy.views).toHaveLength(2)
      expect(viewsQueries.at(-1)).toBe("")
      legacyStatus = false
      const scoped = await controller.status({schemaVersion: 1, scope: "/fixture/project", includeViews: true}, {signal: new AbortController().signal})
      expect(scoped).toMatchObject({scopeProjection: "exact"})
      expect(scoped.views).toHaveLength(1)
    }
  } finally {
    server.stop(true)
    if (previous === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previous
    process.chdir(previousCwd)
    fixture.dispose()
  }
}, 5000)

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
    const result = await controller.check({schemaVersion: 1, scope: "storybook:shared", timeoutMs: 3_000}, {
      signal: new AbortController().signal,
      onProgress: stage => { progress.push(stage) },
    })
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

test("Web check начинает короткий timeout после readiness и сохраняет внешний signal", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousCwd = process.cwd()
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  process.chdir(fixture.toolRoot)
  let checks = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/control/app/web/rebuild") {
        checks += 1
        return Response.json({ok: true})
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
    const external = new AbortController()
    const result = await controller.check({schemaVersion: 1, scope: "storybook:web", timeoutMs: 100}, {signal: external.signal})
    expect(result).toMatchObject({status: "success", ok: true})
    expect(checks).toBe(1)
    expect(external.signal.aborted).toBeFalse()
    external.abort(new Error("external cancellation"))
    await expect(controller.check({schemaVersion: 1, scope: "storybook:web", timeoutMs: 100}, {signal: external.signal}))
      .rejects.toThrow("external cancellation")
    expect(checks).toBe(1)
  } finally {
    server.stop(true)
    if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
    process.chdir(previousCwd)
    fixture.dispose()
  }
}, 5_000)

test.each(["running", "queued"] as const)("shared %s operation остаётся видимой только в shared scope после timeout", async state => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousCwd = process.cwd()
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  process.chdir(fixture.toolRoot)
  let checks = 0
  const operation = {operationId: `shared-${state}`, owner: "shared", packageId: null, state}
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/control/check") {
        checks += 1
        await new Promise<void>(resolve => {
          if (request.signal.aborted) resolve()
          else request.signal.addEventListener("abort", () => resolve(), {once: true})
        })
        return new Response(null, {status: 499})
      }
      if (url.pathname === "/api/control/status") return Response.json({
        packages: [{packageId: "@fixture/pending", buildState: "idle", generation: 1, builds: 0}],
        preflight: {packageIds: url.searchParams.get("scope") === "storybook:shared" ? [] : ["@fixture/pending"]},
        buildScheduler: {
          activeCount: state === "running" ? 1 : 0,
          queuedCount: state === "queued" ? 1 : 0,
          active: state === "running" ? [operation] : [],
          queued: state === "queued" ? [operation] : [],
        },
        discovery: {refreshing: false},
      })
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
    const shared = await controller.check({schemaVersion: 1, scope: "storybook:shared", timeoutMs: 150}, {
      signal: new AbortController().signal,
    })
    expect(shared).toMatchObject({status: "timeout", waitingOnly: true, inProgress: true,
      operationIds: [`shared-${state}`], checkResultKnown: false})
    const packageResult = await controller.check({schemaVersion: 1, scope: "@fixture/pending", timeoutMs: 150}, {
      signal: new AbortController().signal,
    })
    expect(packageResult).toMatchObject({status: "timeout", waitingOnly: true, inProgress: false,
      operationIds: [], checkResultKnown: false})
    expect(checks, "По одному check для каждого явно выбранного scope; timeout не повторяет работу").toBe(2)
  } finally {
    server.stop(true)
    if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
    process.chdir(previousCwd)
    fixture.dispose()
  }
}, 5_000)
