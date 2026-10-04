import {expect, mock, test} from "bun:test"
import createWeb, {type StorybookAppWeb} from "@zavx0z/storybook-app-web"
import type {StorybookAppWebBuild} from "@zavx0z/storybook-app-web-build"
import {createWebArtifacts} from "../spec/fixture/web-artifacts"

type Assets = Awaited<ReturnType<StorybookAppWebBuild.Output["buildAssets"]>>

test("обновление Web адресуется только страницам текущей платформы", async () => {
  const fixture = createWebArtifacts()
  const old = fixture.assets("platform-a", "web-a")
  fixture.save(old)
  const current = fixture.assets("platform-b", "web-b")
  fixture.save(current)
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async () => { throw new Error("Чтение не компилирует") })
  const snapshot = {
    packageId: "@fixture/page", declarationDigest: "fixture", moduleGraphRevision: "fixture",
    candidateRevision: null, activeRevision: "old", lastGoodRevision: "old", entryRelativePath: "entry.js",
    diagnostics: [], dependencyRealpaths: [], subscribers: 1, buildState: "active", builds: 2,
    revisions: [
      {revision: "old", sharedModuleEpoch: old.browserIdentity!.epoch},
      {revision: "current", sharedModuleEpoch: current.browserIdentity!.epoch},
    ].map(value => ({...value, generation: 1, status: "working" as const, declarationDigest: "fixture",
      packageGraphDigest: "fixture", moduleGraphRevision: "fixture", entryRelativePath: "entry.js",
      dependencyRealpaths: [], diagnostics: [], createdAt: "2026-10-03T00:00:00Z", leases: 1})),
  } satisfies ReturnType<StorybookAppWeb.Input["revisions"]>[number]
  const web = createWeb({...fixture.input(build), revisions: () => [snapshot]})
  try {
    expect(web.canRefresh("@fixture/page", "old")).toBeFalse()
    expect(web.canRefresh("@fixture/page", "current")).toBeTrue()
    expect(web.canRefresh(null, null)).toBeTrue()
    expect(web.host(old.browserIdentity!.epoch).pageEntryUrl).toBe(old.browserIdentity!.packageEntryUrl)
    expect(build.mock.calls).toEqual([])
  } finally {
    await web.dispose()
    fixture.dispose()
  }
})

test("конкурентные запросы делят кандидат, а поздний apply публикует его", async () => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  const candidate = fixture.assets("platform-a", "web-b")
  fixture.save(current)
  const gate = Promise.withResolvers<Assets>()
  const started = Promise.withResolvers<void>()
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async input => {
    expect(input.sharedKernel?.epoch, "Web пересобирается поверх опубликованной платформы")
      .toBe(current.browserIdentity!.epoch)
    started.resolve()
    return gate.promise
  })
  const events: string[] = []
  const web = createWeb(fixture.input(build, event => events.push(event.type)))
  try {
    expect(web.read().phase).toBe("idle")
    expect(web.host().hostModuleEpoch).toBe(current.browserIdentity!.hostModuleEpoch)
    expect(build.mock.calls).toHaveLength(0)

    const first = web.rebuild()
    await started.promise
    const second = web.rebuild({apply: true})
    expect(second, "Конкурентный запрос присоединяется к тому же Promise")
      .toBe(first)
    expect(web.read().phase, "Пока worker занят, выпуск остаётся в подготовке")
      .toBe("preparing")
    expect(web.host().hostModuleEpoch, "Опубликованный host остаётся доступным во время подготовки")
      .toBe(current.browserIdentity!.hostModuleEpoch)

    gate.resolve(candidate)
    const result = await first
    expect(result, "Поздний apply повышает общую операцию до публикации без подтверждения browser применения")
      .toMatchObject({ok: true, published: true, applied: false,
        web: {phase: "published", versions: [{platform: current.browserIdentity!.epoch,
          web: candidate.browserIdentity!.hostModuleEpoch}]}})
    expect(build.mock.calls).toHaveLength(1)
    expect(web.host().hostModuleEpoch).toBe(candidate.browserIdentity!.hostModuleEpoch)
    expect(fixture.readPublished()?.browserIdentity?.hostModuleEpoch).toBe(candidate.browserIdentity!.hostModuleEpoch)
    expect(events.filter(type => type === "shared.updated")).toHaveLength(1)
    expect(events.filter(type => type === "app.web").length).toBeGreaterThan(1)
  } finally {
    gate.resolve(candidate)
    await web.dispose()
    fixture.dispose()
  }
})

test("ошибка подготовки сохраняет прежнюю опубликованную оболочку", async () => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  fixture.save(current)
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async () => { throw new Error("fixture build failed") })
  const events: string[] = []
  const web = createWeb(fixture.input(build, event => events.push(event.type)))
  try {
    await expect(web.rebuild({apply: true})).rejects.toThrow("fixture build failed")
    expect(web.read().phase, "Отказ виден в состоянии Web").toBe("failed")
    expect(web.error?.message, "Диагностика остаётся доступной после отказа").toBe("fixture build failed")
    expect(web.host().hostModuleEpoch, "Страница продолжает читать прежний host")
      .toBe(current.browserIdentity!.hostModuleEpoch)
    expect(fixture.readPublished()?.browserIdentity?.hostModuleEpoch,
      "Отказ не заменяет опубликованный receipt").toBe(current.browserIdentity!.hostModuleEpoch)
    expect(events, "Отказ отправляет диагностику без события обновления")
      .toContain("shared.failed")
    expect(events).not.toContain("shared.updated")
  } finally {
    await web.dispose()
    fixture.dispose()
  }
})

test("dispose ждёт cleanup Web worker и сохраняет общую очередь", async () => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  fixture.save(current)
  const started = Promise.withResolvers<AbortSignal>()
  const cleanup = Promise.withResolvers<void>()
  let cleaned = false
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async (_input, context) => {
    started.resolve(context.signal)
    await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), {once: true}))
    await cleanup.promise
    cleaned = true
    context.signal.throwIfAborted()
    return current
  })
  const web = createWeb(fixture.input(build))
  const checking = web.check({apply: true}, new AbortController().signal).catch(() => null)
  try {
    const signal = await started.promise
    let closed = false
    const stopping = web.dispose().then(() => { closed = true })
    await Promise.resolve()
    expect(signal.aborted, "Завершение Web отменяет его собственный worker").toBeTrue()
    expect(closed, "Web ждёт освобождения занятого слота").toBeFalse()
    expect(fixture.scheduler.snapshot().activeCount, "Общая очередь видит незавершённую очистку")
      .toBe(1)
    cleanup.resolve()
    await stopping
    await checking
    expect(cleaned).toBeTrue()
    expect(fixture.scheduler.snapshot().activeCount).toBe(0)
    expect(await fixture.scheduler.run(async () => "other owner", new AbortController().signal),
      "Общая очередь остаётся работоспособной после завершения Web").toBe("other owner")
    expect(fixture.readPublished()?.browserIdentity?.hostModuleEpoch).toBe(current.browserIdentity!.hostModuleEpoch)
  } finally {
    cleanup.resolve()
    await web.dispose()
    await checking
    fixture.dispose()
  }
})


test("новая среда публикуется одним build, старая страница читает прежний готовый host", async () => {
  const fixture = createWebArtifacts()
  const old = fixture.assets("platform-a", "web-a")
  fixture.save(old)
  const next = fixture.assets("platform-b", "web-b")
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async input => {
    expect(input.sharedKernel).toBeDefined()
    return next
  })
  let revisionReads = 0
  const web = createWeb({...fixture.input(build), revisions: () => { revisionReads++; return [] }})
  try {
    expect(web.host(old.browserIdentity!.epoch).hostModuleEpoch).toBe(old.browserIdentity!.hostModuleEpoch)
    const result = await web.check({apply: true}, new AbortController().signal)
    expect(result).toMatchObject({ok: true, published: true})
    expect(result.hosts).toHaveLength(1)
    expect(build.mock.calls).toHaveLength(1)
    expect(revisionReads, "История пакетов не создаёт дополнительные сборки Web").toBe(0)
    expect(web.host().sharedModuleEpoch).toBe(next.browserIdentity!.epoch)
    expect(web.host(old.browserIdentity!.epoch).hostModuleEpoch).toBe(old.browserIdentity!.hostModuleEpoch)
    await web.check({}, new AbortController().signal)
    expect(build.mock.calls).toHaveLength(2)
  } finally {
    await web.dispose()
    fixture.dispose()
  }
})

test("отдельный выпуск Web обновляет текущую платформу без пересборки старой", async () => {
  const fixture = createWebArtifacts()
  const old = fixture.assets("platform-a", "web-a")
  fixture.save(old)
  const current = fixture.assets("platform-b", "web-b")
  fixture.save(current)
  const next = fixture.assets("platform-b", "web-c")
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async input => {
    expect(input.sharedKernel?.epoch).toBe(current.browserIdentity!.epoch)
    return next
  })
  const web = createWeb(fixture.input(build))
  try {
    expect(web.host(old.browserIdentity!.epoch).hostModuleEpoch).toBe(old.browserIdentity!.hostModuleEpoch)
    expect((await web.rebuild({apply: true})).published).toBeTrue()
    expect(build.mock.calls).toHaveLength(1)
    expect(web.host().hostModuleEpoch).toBe(next.browserIdentity!.hostModuleEpoch)
    expect(web.host(old.browserIdentity!.epoch).hostModuleEpoch).toBe(old.browserIdentity!.hostModuleEpoch)
  } finally {
    await web.dispose()
    fixture.dispose()
  }
})

test.each([false, true])("отменённый apply не публикует, healthy concurrent apply=%s задаёт публикацию", async healthyApply => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  fixture.save(current)
  const candidate = fixture.assets("platform-b", "web-b")
  const gate = Promise.withResolvers<Assets>()
  const started = Promise.withResolvers<void>()
  let signal: AbortSignal | undefined
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async (_input, context) => {
    signal = context.signal
    started.resolve()
    return gate.promise
  })
  const events: string[] = []
  const web = createWeb(fixture.input(build, event => events.push(event.type)))
  const cancellation = new AbortController()
  try {
    const canceled = web.check({apply: true}, cancellation.signal).catch(error => error)
    await started.promise
    const healthy = web.check({apply: healthyApply}, new AbortController().signal)
    cancellation.abort()
    expect(await canceled).toMatchObject({name: "AbortError"})
    expect(signal!.aborted).toBeFalse()
    expect(events).not.toContain("shared.updated")
    gate.resolve(candidate)
    expect(await healthy).toMatchObject({ok: true, published: healthyApply})
    expect(events.filter(type => type === "shared.updated")).toHaveLength(healthyApply ? 1 : 0)
    expect(build.mock.calls).toHaveLength(1)
  } finally {
    gate.resolve(candidate)
    await web.dispose()
    fixture.dispose()
  }
})

test("после отмены ожидания следующий check получает свежую сборку без поздней публикации", async () => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  fixture.save(current)
  const candidate = fixture.assets("platform-b", "web-b")
  const gate = Promise.withResolvers<Assets>()
  const started = Promise.withResolvers<AbortSignal>()
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async (_input, context) => {
    started.resolve(context.signal)
    return gate.promise
  })
  const web = createWeb(fixture.input(build))
  const cancellation = new AbortController()
  try {
    const first = web.check({apply: true}, cancellation.signal).catch(error => error)
    const signal = await started.promise
    cancellation.abort()
    expect(await first).toMatchObject({name: "AbortError"})
    const next = web.check({}, new AbortController().signal)
    expect(signal.aborted).toBeFalse()
    gate.resolve(candidate)
    expect(await next).toMatchObject({ok: true, published: false})
    expect(build.mock.calls).toHaveLength(2)
    expect(fixture.readPublished()?.browserIdentity?.hostModuleEpoch).toBe(current.browserIdentity!.hostModuleEpoch)
  } finally {
    gate.resolve(candidate)
    await web.dispose()
    fixture.dispose()
  }
})

test.each(["shared-first", "web-first"] as const)("shared и WebOnly сохраняют кандидатов при пересечении: %s", async order => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  fixture.save(current)
  const shared = fixture.assets("platform-b", "web-b")
  const webForA = fixture.assets("platform-a", "web-c-a")
  const webForB = fixture.assets("platform-b", "web-c-b")
  const gate = Promise.withResolvers<Assets>()
  const started = Promise.withResolvers<void>()
  const preparedAssets = fixture.assets("prepared-platform", "prepared-host")
  const prepared = {identity: preparedAssets.browserIdentity!}
  const seen: (string | undefined)[] = []
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async input => {
    seen.push(input.sharedKernel?.epoch)
    if (seen.length === 1) {
      started.resolve()
      return gate.promise
    }
    return input.sharedKernel.epoch === prepared.identity.epoch ? shared
      : input.sharedKernel.epoch === current.browserIdentity!.epoch ? webForA : webForB
  })
  const events: string[] = []
  const web = createWeb(fixture.input(build, event => events.push(event.type)))
  try {
    const first = order === "shared-first" ? web.check({apply: true}, new AbortController().signal) : web.rebuild({apply: true})
    await started.promise
    const next = order === "shared-first" ? web.rebuild({apply: true}) : web.check({apply: true}, new AbortController().signal)
    await Promise.resolve()
    expect(build.mock.calls).toHaveLength(1)
    gate.resolve(order === "shared-first" ? shared : webForA)
    const results = await Promise.all([first, next])
    expect(results.every(result => result.ok && result.published)).toBeTrue()
    expect(build.mock.calls).toHaveLength(2)
    expect(events.filter(type => type === "shared.updated")).toHaveLength(2)
    expect(seen).toEqual(order === "shared-first" ? [prepared.identity.epoch, shared.browserIdentity!.epoch]
      : [current.browserIdentity!.epoch, prepared.identity.epoch])
    expect(web.host().hostModuleEpoch).toBe(order === "shared-first" ? webForB.browserIdentity!.hostModuleEpoch : shared.browserIdentity!.hostModuleEpoch)
  } finally {
    gate.resolve(order === "shared-first" ? shared : webForA)
    await web.dispose()
    fixture.dispose()
  }
})

test("Web rebuild никогда не вызывает подготовку платформы, в том числе без готовой среды", async () => {
  const fixture = createWebArtifacts()
  const prepared = mock<NonNullable<StorybookAppWeb.Input["preparePlatform"]>>(async () => { throw new Error("Платформа не должна собираться") })
  const build = mock<StorybookAppWebBuild.Output["runWorker"]>(async () => fixture.assets("platform-a", "web-next"))
  let web = createWeb({...fixture.input(build), preparePlatform: prepared})
  try {
    await expect(web.rebuild({apply: true})).rejects.toThrow()
    expect(prepared).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
    await web.dispose()
    fixture.save(fixture.assets("platform-a", "web-current"))
    web = createWeb({...fixture.input(build), preparePlatform: prepared})
    expect((await web.rebuild({apply: true})).published).toBeTrue()
    expect(prepared).not.toHaveBeenCalled()
    expect(build).toHaveBeenCalledTimes(1)
  } finally {
    await web.dispose()
    fixture.dispose()
  }
})
