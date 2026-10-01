import {expect, mock, test} from "bun:test"
import createWeb from "@app/web"
import type {Contract} from "@app/web"

const versions = [{platform: "platform-a", web: "web-b"}] as const

test("конкурентное применение использует одну подготовку и общий результат", async () => {
  const prepared = Promise.withResolvers<string>()
  const prepare = mock((_signal: AbortSignal) => prepared.promise)
  const publish = mock((_candidate: string) => {})
  const web = createWeb({prepare, versions: () => versions, publish})
  try {
    const first = web.rebuild()
    const second = web.rebuild({apply: true})
    expect(second).toBe(first)
    prepared.resolve("candidate-b")
    expect(await first).toMatchObject({phase: "published", versions})
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls).toEqual([["candidate-b"]])
  } finally { await web.dispose() }
})

test("подготовка без применения сохраняет опубликованные байты", async () => {
  let published = "web-a"
  const publish = mock((candidate: string) => { published = candidate })
  const web = createWeb({prepare: async () => "web-b", versions: () => versions, publish})
  try {
    expect(await web.rebuild()).toMatchObject({phase: "prepared", versions})
    expect(published).toBe("web-a")
    expect(publish).not.toHaveBeenCalled()
  } finally { await web.dispose() }
})

test("ошибка подготовки сохраняет рабочий выпуск и допускает исправленный запрос", async () => {
  let published = "web-a"
  let fail = true
  const web = createWeb({
    prepare: async () => {
      if (fail) throw new Error("compiler rejected")
      return "web-b"
    },
    versions: () => versions,
    publish(candidate) { published = candidate },
  })
  try {
    await expect(web.rebuild({apply: true})).rejects.toThrow("compiler rejected")
    expect(web.read()).toMatchObject({phase: "failed", error: "compiler rejected"})
    expect(published).toBe("web-a")
    fail = false
    expect(await web.rebuild({apply: true})).toMatchObject({phase: "published", error: null})
    expect(published).toBe("web-b")
  } finally { await web.dispose() }
})

test("завершение из уведомления publishing исключает позднюю публикацию", async () => {
  const publish = mock((_candidate: string) => {})
  const web = createWeb({prepare: async () => "web-b", versions: () => versions, publish})
  let disposal: Promise<void> | undefined
  const unsubscribe = web.subscribe(state => {
    if (state.phase === "publishing") disposal = web.dispose()
  })
  try {
    await expect(web.rebuild({apply: true})).rejects.toMatchObject({name: "AbortError"})
    await disposal
    expect(publish).not.toHaveBeenCalled()
    await expect(web.rebuild()).rejects.toThrow("Приложение завершает работу")
  } finally {
    unsubscribe()
    await web.dispose()
  }
})

test("наблюдатель preparing присоединяется к операции и запрашивает её применение", async () => {
  const prepare = mock(async (_signal: AbortSignal) => "web-b")
  const publish = mock((_candidate: string) => {})
  const web = createWeb({prepare, versions: () => versions, publish})
  let reentrant: Promise<ReturnType<Contract.Output["read"]>> | undefined
  const unsubscribe = web.subscribe(state => {
    if (state.phase === "preparing") reentrant = web.rebuild({apply: true})
  })
  try {
    const first = web.rebuild()
    expect(reentrant).toBe(first)
    expect(await first).toMatchObject({phase: "published"})
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls).toEqual([["web-b"]])
  } finally {
    unsubscribe()
    await web.dispose()
  }
})

test("отключение наблюдателя сохраняет работу, ошибка initial callback не оставляет подписку", async () => {
  const prepared = Promise.withResolvers<string>()
  const publish = mock((_candidate: string) => {})
  const web = createWeb({prepare: () => prepared.promise, versions: () => versions, publish})
  const failedListener = mock(() => { throw new Error("observer failed") })
  const successfulListener = mock((_state: ReturnType<Contract.Output["read"]>) => {})
  const unsubscribeFailed = web.subscribe(failedListener)
  const unsubscribe = web.subscribe(successfulListener)
  try {
    const operation = web.rebuild({apply: true})
    unsubscribe()
    const calls = successfulListener.mock.calls.length
    prepared.resolve("web-b")
    expect(await operation).toMatchObject({phase: "published"})
    expect(failedListener).toHaveBeenCalledTimes(1)
    expect(successfulListener.mock.calls).toHaveLength(calls)
    expect(publish).toHaveBeenCalledTimes(1)
  } finally {
    unsubscribeFailed()
    unsubscribe()
    await web.dispose()
  }
})
