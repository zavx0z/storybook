import {afterAll, describe, expect, mock, test} from "bun:test"
import {readdirSync} from "node:fs"
import runBuildWorker from "@storybook-tech-build/worker"
import {prepareWorkerFixture} from "../fixtures/prepare"
import type {StorybookTechBuildWorker} from "@storybook-tech-build/worker"

type LifecycleEvent = Parameters<NonNullable<StorybookTechBuildWorker.Input<unknown, unknown>["onLifecycle"]>>[0]

describe.each([
  {
    name: "Строгий поток завершённой задачи",
    props: {streamMode: "strict" as const},
    job: {result: {value: 42}, stderr: "warning"},
    expected: {exitCode: 0, stderr: "warning", result: {value: 42}},
  },
  {
    name: "Терпимый поток завершённой задачи",
    props: {streamMode: "tolerant" as const},
    job: {result: null, exitCode: 7},
    expected: {exitCode: 7, stderr: "", result: null},
  },
  {
    name: "Завершение без файла результата",
    props: {streamMode: "strict" as const},
    job: {resultMode: "missing" as const},
    expected: {exitCode: 0, stderr: "", result: undefined},
  },
])("$name", async ({props, job, expected}) => {
  const fixture = prepareWorkerFixture(job)
  afterAll(fixture.cleanup)
  const onProgress = mock((_event: string) => {})
  const onLifecycle = mock((_event: LifecycleEvent) => {})
  const result = await runBuildWorker({
    ...fixture.input,
    streamMode: props.streamMode,
    onProgress,
    onLifecycle,
  })

  test("Состав результата", () => {
    expect(result, "Один запуск возвращает identity, handshake, exit и независимую диагностику с JSON результатом").toEqual({
      workerId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      ready: true,
      exitCode: expected.exitCode,
      stderr: expected.stderr,
      result: expected.result,
    })
  })
  test("Идентичность запуска", () => {
    expect(result.workerId, "Каждый запуск получает непредсказуемый UUID").toMatch(/^[a-f0-9-]{36}$/u)
  })
  test("Подтверждение процесса", () => {
    expect(result.ready, "Ready подтверждает nonce и PID именно созданного worker").toBeTrue()
  })
  test("Код завершения", () => {
    expect(result.exitCode, "Ненулевой код остаётся данными для вызывающего владельца").toBe(expected.exitCode)
  })
  test("Диагностический поток", () => {
    expect(result.stderr, "stderr возвращается отдельно от JSON результата").toBe(expected.stderr)
  })
  test("Файл результата", () => {
    expect(result.result, "Отсутствие файла выражено undefined, допустимый JSON null сохраняется").toEqual(expected.result)
  })
  test("Неизменяемость", () => {
    expect(Object.isFrozen(result), "Завершённый запуск публикует замороженный envelope").toBeTrue()
  })
  test("События задачи", () => {
    expect(onProgress.mock.calls, "Owner получает payload после подтверждённого ready").toEqual([["compile"]])
  })
  test("Жизненный цикл", () => {
    expect(onLifecycle.mock.calls.map(([event]) => event.state), "Подтверждённый запуск публикует started и exited в порядке жизни процесса").toEqual(["started", "exited"])
    expect(onLifecycle.mock.calls.map(([event]) => event.workerId), "Оба события относятся к identity возвращённого запуска").toEqual([result.workerId, result.workerId])
  })
  test("Освобождение области", () => {
    expect(readdirSync(fixture.root), "Собственный каталог удалён до возврата результата").toEqual([])
  })
})
