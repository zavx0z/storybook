import {describe, expect, mock, test} from "bun:test"
import {readdirSync} from "node:fs"
import runBuildWorker from "@build/worker"
import type {BuildWorkerLifecycleEvent} from "@build/worker"
import readWorkerEvents from "../src/read-events"
import {parseFixtureEvent, prepareWorkerFixture} from "../fixtures/prepare"

describe("Подтверждение потока worker", () => {
  test("Точный nonce и PID; лишние записи tolerant не создают lifecycle", async () => {
    const fixture = prepareWorkerFixture({
      records: ["phase", "wrong-nonce", "wrong-pid", "malformed", "unknown", "ready", "ready", "phase"],
      resultMode: "metadata",
    })
    const onLifecycle = mock((_event: BuildWorkerLifecycleEvent) => {})
    const onProgress = mock((_event: string) => {})
    try {
      const result = await runBuildWorker({...fixture.input, streamMode: "tolerant", onLifecycle, onProgress})
      const metadata = result.result as {workerId: string, pid: number}
      expect(onLifecycle.mock.calls.map(([event]) => event.state), "Неверный nonce/PID и duplicate ready не получают права открыть lifecycle").toEqual(["started", "exited"])
      expect(onLifecycle.mock.calls.map(([event]) => event.pid), "Оба callback привязаны к PID, подтверждённому реально запущенным child").toEqual([metadata.pid, metadata.pid])
      expect(onLifecycle.mock.calls.map(([event]) => event.workerId), "Только argv nonce созданного worker совпадает с returned identity").toEqual([metadata.workerId, result.workerId])
      expect(onProgress.mock.calls, "Phase-before-ready игнорируется; payload после handshake доставляется один раз").toEqual([["compile"]])
    } finally {
      fixture.cleanup()
    }
  })

  test.each([
    {name: "malformed JSON", records: ["malformed"] as const},
    {name: "unknown event", records: ["unknown"] as const},
    {name: "wrong nonce", records: ["wrong-nonce"] as const},
    {name: "wrong PID", records: ["wrong-pid"] as const},
    {name: "duplicate ready", records: ["ready", "ready"] as const},
    {name: "phase-before-ready", records: ["phase"] as const},
  ])("Strict отклоняет $name и завершает процесс", async ({records}) => {
    const fixture = prepareWorkerFixture({records, hold: true})
    try {
      await expect(runBuildWorker(fixture.input), "Неверный strict поток становится reader error и останавливает child через штатное wait").rejects.toThrow("output reader failed")
      expect(readdirSync(fixture.root), "Ошибка strict parser удаляет собственную рабочую область после exit").toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  test("Исключение owner parser не маскируется tolerant режимом", async () => {
    const fixture = prepareWorkerFixture({hold: true})
    const cause = new Error("parser is broken")
    try {
      const failure = await runBuildWorker({...fixture.input, streamMode: "tolerant", parseEvent() {throw cause}}).catch(error => error)
      expect(failure.cause, "Invalid JSON игнорируется в tolerant, исключение самого owner parser сохраняется как transport cause").toBe(cause)
      expect(readdirSync(fixture.root), "Reader failure ожидает завершение child и cleanup до rejection").toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  test.each(["strict", "tolerant"] as const)("Пустой поток %s сохраняет failure result без ready", async streamMode => {
    const fixture = prepareWorkerFixture({records: [], result: {error: "compiler failure"}, stderr: "warning", exitCode: 8})
    const onLifecycle = mock((_event: BuildWorkerLifecycleEvent) => {})
    try {
      const result = await runBuildWorker({...fixture.input, streamMode, onLifecycle})
      expect(result.ready, "EOF без handshake возвращает ready=false для решения владельца").toBeFalse()
      expect(result.result, "Структурный failure result сохраняется при stderr warning и ненулевом exit").toEqual({error: "compiler failure"})
      expect(result.stderr, "stderr не вытесняет JSON диагностику").toBe("warning")
      expect(result.exitCode, "Failure exit остаётся частью transport output").toBe(8)
      expect(onLifecycle.mock.calls, "Без confirmed started событие exited не публикуется").toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  test("Tolerant принимает EOF tail, strict требует newline", async () => {
    const tolerant = prepareWorkerFixture({records: ["ready"], tail: true})
    const strict = prepareWorkerFixture({records: ["ready"], tail: true})
    try {
      const result = await runBuildWorker({...tolerant.input, streamMode: "tolerant"})
      expect(result.ready, "Завершённая JSON запись без newline разрешена прежней tolerant политикой").toBeTrue()
      const failure = await runBuildWorker(strict.input).catch(error => error)
      expect(failure.cause.message, "Незавершённая strict строка остаётся транспортной ошибкой").toContain("incomplete")
    } finally {
      tolerant.cleanup()
      strict.cleanup()
    }
  })

  test("Tolerant дренирует большой stdout до завершения child", async () => {
    const fixture = prepareWorkerFixture({floodBytes: 2 * 1024 * 1024, result: {done: true}})
    try {
      const result = await runBuildWorker({...fixture.input, streamMode: "tolerant"})
      expect(result.exitCode, "Pipe продолжает дренироваться после ограничения; child не блокируется на полном stdout").toBe(0)
      expect(result.result, "Worker завершил запись результата после большого stdout").toEqual({done: true})
    } finally {
      fixture.cleanup()
    }
  })
})

describe("Ограничение event reader", () => {
  test("Tolerant сохраняет total bytes boundary и игнорирует длинные строки", async () => {
    const onReady = mock(() => {})
    const onProgress = mock((_event: string) => {})
    const chunks = [
      '{"kind":"phase","event":"before"}\n',
      JSON.stringify({kind: "ready", workerId: "nonce", pid: 123}) + "\n",
      JSON.stringify({kind: "phase", event: "a".repeat(8192)}) + "\n",
      '{"kind":"phase","event":"accepted"}\n',
      "x".repeat(65_536),
      '{"kind":"phase","event":"after-limit"}\n',
    ]
    let drained = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[drained++]
        if (chunk === undefined) controller.close()
        else controller.enqueue(new TextEncoder().encode(chunk))
      },
    })
    await readWorkerEvents(stream, {workerId: "nonce", pid: 123, mode: "tolerant", parseEvent: parseFixtureEvent, onReady, onProgress})
    expect(onReady.mock.calls, "Handshake, расположенный до total byte limit, подтверждается один раз").toEqual([[]])
    expect(onProgress.mock.calls, "Длинная строка и события после byte limit игнорируются").toEqual([["accepted"]])
    expect(drained, "Все chunks и EOF прочитаны, включая данные после ограничения").toBe(chunks.length + 1)
  })

  test("Strict ограничивает pending buffer", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {controller.enqueue(new TextEncoder().encode("x".repeat(65_537)))},
    })
    await expect(readWorkerEvents(stream, {workerId: "nonce", pid: 123, mode: "strict", parseEvent: parseFixtureEvent, onReady() {}, onProgress() {}}), "Strict буфер остаётся bounded даже без newline").rejects.toThrow("buffer exceeds limit")
  })

  test.each(["strict", "tolerant"] as const)("Ошибка pipe сохраняется в %s", async mode => {
    const cause = new Error("read failed")
    const stream = new ReadableStream<Uint8Array>({start(controller) {controller.error(cause)}})
    await expect(readWorkerEvents(stream, {workerId: "nonce", pid: 123, mode, parseEvent: parseFixtureEvent, onReady() {}, onProgress() {}}), "Выбранная политика parsing не подавляет исключение stream reader").rejects.toBe(cause)
  })
})
