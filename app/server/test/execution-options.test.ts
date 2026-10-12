import {expect, test} from "bun:test"
const codex = {id: "codex", provider: "codex" as const, label: "Codex", enabled: true}

import {createExecutionOptions} from "../src/execution-options"
import type {OpenProviderPeer} from "../src/provider-routing"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"

test("закрытие среды ожидает cleanup probe и не принимает новый запрос", async () => {
  const started = Promise.withResolvers<void>()
  const cleanup = Promise.withResolvers<void>()
  let prompts = 0
  const options = createExecutionOptions({project: "/fixture", toolRoot: "/fixture", async connect(input) {
    started.resolve()
    return {
      sessionId: "probe", capabilities: {}, configOptions: [],
      async setConfigOption() {return []}, async prompt() {prompts++; return {stopReason: "end_turn"}},
      async cancel() {}, async dispose() {await cleanup.promise},
    }
  }})
  const pending = options.read(codex, undefined, new AbortController().signal)
  await started.promise
  let disposed = false
  const closing = options.dispose().then(() => {disposed = true})
  await Promise.resolve()
  expect(disposed).toBe(false)
  await expect(options.read(codex, undefined, new AbortController().signal)).rejects.toThrow("закрыта")
  cleanup.resolve()
  await pending
  await closing
  expect(disposed).toBe(true)
  expect(prompts).toBe(0)
})

test("сбой подготовки Codex объясняет действие пользователя и сохраняет причину", async () => {
  const cause = new AggregateError([new Error("startup"), new Error("cleanup")], "ACP startup")
  const options = createExecutionOptions({project: "/fixture", toolRoot: "/fixture", async connect() {throw cause}})
  try {
    await options.read(codex, undefined, new AbortController().signal)
    throw new Error("Ожидался отказ")
  } catch (error) {
    expect((error as Error).message).toBe("Не удалось завершить подключение Codex. Повторите загрузку моделей")
    expect((error as Error).cause).toBe(cause)
  } finally {await options.dispose()}
})

test("peer model probe uses explicit factory and temporary assignment without prompt or resume", async () => {
  const selected = {...codex, id: "stable-peer", peer: {peerId: "remote", executorId: "configured-codex"}}
  const opened: Parameters<OpenProviderPeer>[0][] = []
  let received: StorybookTechAcp.Input | undefined
  let prompts = 0
  let released = 0
  const stream: NonNullable<StorybookTechAcp.Input["ownedStream"]> = {
    stream: {readable: new ReadableStream(), writable: new WritableStream()}, closed: new Promise(() => {}), async dispose() {released++},
  }
  const options = createExecutionOptions({project: "/fixture", toolRoot: "/absent-no-native-resolution",
    async openPeer(input) {
      opened.push(input)
      return stream
    },
    async connect(input) {
      received = input
      return {sessionId: "probe-native", capabilities: {}, configOptions: [{id: "model", category: "model", name: "Model", type: "select", currentValue: "m1", options: [{value: "m1", name: "M1"}]}],
        async setConfigOption() {return []},
        async prompt() {
          prompts++
          return {stopReason: "end_turn"}
        },
        async cancel() {}, async dispose() {await input.ownedStream?.dispose()}}
    },
  })
  try {
    expect(await options.read(selected, undefined, new AbortController().signal)).toMatchObject([{value: "m1"}])
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({connectionId: selected.id, ...selected.peer})
    expect(opened[0]?.assignmentId).toStartWith("capabilities:")
    expect(opened[0]?.previousSessionId).toBeUndefined()
    expect(received?.ownedStream).toBe(stream)
    expect(received?.cwd).toBe("/fixture")
    expect(received?.command).toBeUndefined()
    expect(received?.exclusiveMcp).toBeUndefined()
    expect(prompts).toBe(0)
    expect(released).toBe(1)
  } finally {await options.dispose()}
})

test("peer model probe fails before connecting when host has no factory", async () => {
  let connections = 0
  const options = createExecutionOptions({project: "/fixture", toolRoot: "/absent", async connect(): Promise<StorybookTechAcp.Output> {
    connections++
    throw new Error("must not connect")
  }})
  try {
    await expect(options.read({...codex, peer: {peerId: "remote", executorId: "configured"}}, undefined, new AbortController().signal)).rejects.toThrow("не настроен хостом")
    expect(connections).toBe(0)
  } finally {await options.dispose()}
})
