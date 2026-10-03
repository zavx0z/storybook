import {expect, mock, test} from "bun:test"
import createWeb from "@app/web"
import type {AppWebBuild} from "@app-web/build"
import {createWebArtifacts} from "../spec/fixture/web-artifacts"

type Assets = Awaited<ReturnType<AppWebBuild.Output["buildAssets"]>>

test("конкурентные запросы делят кандидат, а поздний apply публикует его", async () => {
  const fixture = createWebArtifacts()
  const current = fixture.assets("platform-a", "web-a")
  const candidate = fixture.assets("platform-a", "web-b")
  fixture.save(current)
  const gate = Promise.withResolvers<Assets>()
  const started = Promise.withResolvers<void>()
  const build = mock<AppWebBuild.Output["runWorker"]>(async input => {
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
  const build = mock<AppWebBuild.Output["runWorker"]>(async () => { throw new Error("fixture build failed") })
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
  const build = mock<AppWebBuild.Output["runWorker"]>(async (_input, context) => {
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
