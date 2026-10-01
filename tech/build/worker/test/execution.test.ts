import {describe, expect, test} from "bun:test"
import {existsSync, mkdirSync, readdirSync, writeFileSync} from "node:fs"
import {join, relative} from "node:path"
import runBuildWorker from "@build/worker"
import type {BuildWorker} from "@build/worker"
import {prepareWorkerFixture} from "../fixtures/prepare"

type LifecycleEvent = Parameters<NonNullable<BuildWorker.Input<unknown, unknown>["onLifecycle"]>>[0]

describe("Временная область и результат", () => {
  test("относительный temporaryRoot не зависит от cwd дочернего процесса", async () => {
    const fixture = prepareWorkerFixture({result: {done: true}})
    try {
      const result = await runBuildWorker({
        ...fixture.input,
        temporaryRoot: relative(process.cwd(), fixture.root),
      })
      expect(result.ready, "Child находит input.json при рабочем каталоге, отличном от каталога вызывающего процесса").toBeTrue()
      expect(result.exitCode, "Относительный путь родителя не становится ошибкой чтения задания").toBe(0)
      expect(result.result, "Файл результата читается из того же собственного workspace").toEqual({done: true})
      expect(readdirSync(fixture.root), "Канонизация не меняет границу очистки").toEqual([])
    } finally { fixture.cleanup() }
  })

  test("Private mode, argv nonce, cwd и соседние файлы", async () => {
    const fixture = prepareWorkerFixture({resultMode: "metadata"})
    mkdirSync(join(fixture.root, "neighbor"))
    writeFileSync(join(fixture.root, "keep.txt"), "keep")
    let directory = ""
    try {
      const result = await runBuildWorker({...fixture.input, createJob(workspace) {
        directory = workspace.directory
        expect(Object.keys(workspace), "createJob получает только identity и каталог собственного запуска").toEqual(["workerId", "directory"])
        return {resultMode: "metadata"}
      }})
      expect(result.result, "Child получил exact argv nonce, private files и заданный cwd").toEqual({
        workerId: result.workerId,
        pid: expect.any(Number),
        cwd: fixture.root,
        jobMode: 0o600,
        directoryMode: 0o700,
        directory,
      })
      expect(existsSync(directory), "Собственный temporary directory удалён до возврата").toBeFalse()
      expect(readdirSync(fixture.root).sort(), "Чужие siblings и родитель не удаляются").toEqual(["keep.txt", "neighbor"])
    } finally {
      fixture.cleanup()
    }
  })

  test("Observer exceptions не меняют lifecycle и outcome", async () => {
    const fixture = prepareWorkerFixture({result: {ok: true}})
    const lifecycle: LifecycleEvent[] = []
    const progress: string[] = []
    try {
      const result = await runBuildWorker({...fixture.input,
        onLifecycle(event) {
          lifecycle.push(event)
          throw new Error("lifecycle observer")
        },
        onProgress(event) {
          progress.push(event)
          throw new Error("progress observer")
        },
      })
      const observedAtReturn = {lifecycle: lifecycle.length, progress: progress.length}
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(result.result, "Исключение наблюдателя не становится ошибкой сборки").toEqual({ok: true})
      expect(lifecycle.map(event => event.state), "Ошибки обоих callbacks не препятствуют started/exited").toEqual(["started", "exited"])
      expect(progress, "Observer failure не повторяет доставку phase").toEqual(["compile"])
      expect({lifecycle: lifecycle.length, progress: progress.length}, "После return callbacks больше не выполняются").toEqual(observedAtReturn)
      expect(lifecycle[0]?.startedAt, "Started timestamp присутствует по часам родителя").toSatisfy(value => typeof value === "string" && Number.isFinite(Date.parse(value)))
      expect(lifecycle[1]?.startedAt, "Exited сохраняет startedAt одного запуска").toBe(lifecycle[0]?.startedAt)
    } finally {
      fixture.cleanup()
    }
  })

  test.each([
    {name: "invalid JSON", mode: "invalid" as const, limit: undefined, expected: "JSON"},
    {name: "oversized JSON", mode: "large" as const, limit: 128, expected: "result exceeds limit"},
  ])("Ошибка $name сохраняется после child exit и cleanup", async ({mode, limit, expected}) => {
    const fixture = prepareWorkerFixture({resultMode: mode})
    const lifecycle: LifecycleEvent[] = []
    try {
      const failure = await runBuildWorker({
        ...fixture.input,
        ...(limit === undefined ? {} : {maxResultBytes: limit}),
        onLifecycle(event) {lifecycle.push(event)},
      }).catch(error => error)
      expect(failure.message, "Ошибка чтения result.json не публикует successful output").toContain(expected)
      expect(lifecycle.map(event => event.state), "Ошибка файла результата не отменяет подтверждённый exit").toEqual(["started", "exited"])
      expect(readdirSync(fixture.root), "Неуспешное чтение очищает собственную область").toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  test("Результат без заданного лимита читается полностью", async () => {
    const fixture = prepareWorkerFixture({resultMode: "large"})
    try {
      const result = await runBuildWorker(fixture.input)
      expect(result.result, "Отсутствие maxResultBytes сохраняет прежний unlimited file contract").toBe("x".repeat(2048))
    } finally {
      fixture.cleanup()
    }
  })

  test.each(["createJob", "serialize", "spawn", "abort-setup"] as const)("Setup failure %s удаляет созданную область", async kind => {
    const fixture = prepareWorkerFixture()
    mkdirSync(join(fixture.root, "neighbor"))
    let directory = ""
    const circular: Record<string, unknown> = {}
    circular.self = circular
    try {
      const failure = await runBuildWorker({...fixture.input,
        cwd: kind === "spawn" ? join(fixture.root, "missing-cwd") : fixture.root,
        createJob(workspace): unknown {
          directory = workspace.directory
          if (kind === "createJob") throw new Error("setup refused")
          if (kind === "serialize") return circular
          if (kind === "abort-setup") fixture.controller.abort(new Error("setup cancelled"))
          return {}
        },
      }).catch(error => error)
      expect(failure, "Подготовка не превращает createJob/write/spawn/abort failure в результат").toBeInstanceOf(Error)
      expect(existsSync(directory), "Удаляется только каталог, выделенный до setup failure").toBeFalse()
      expect(readdirSync(fixture.root), "Неуспешная подготовка сохраняет соседнюю область").toEqual(["neighbor"])
    } finally {
      fixture.cleanup()
    }
  })

  test("Ошибка записи job удаляет собственный workspace", async () => {
    const fixture = prepareWorkerFixture()
    let directory = ""
    try {
      await expect(runBuildWorker({...fixture.input, createJob(workspace) {
        directory = workspace.directory
        mkdirSync(join(directory, "input.json"))
        return {}
      }}), "Конфликт input.json вызывает реальную ошибку filesystem write").rejects.toThrow()
      expect(existsSync(directory), "Write failure выполняет тот же owned cleanup").toBeFalse()
      expect(readdirSync(fixture.root), "Родитель workspace остаётся пустым").toEqual([])
    } finally {
      fixture.cleanup()
    }
  })
})

describe("Отклонение входа до spawn", () => {
  test.each([0, -1, Infinity, NaN])("Неверный timeout %s не создаёт job", async timeoutMs => {
    const fixture = prepareWorkerFixture()
    let called = false
    try {
      await expect(runBuildWorker({...fixture.input, timeoutMs, createJob() {
        called = true
        return {}
      }}), "Некорректный timeout не выпускает child до wait validation").rejects.toBeInstanceOf(RangeError)
      expect(called, "Валидация предшествует createJob и temporary directory").toBeFalse()
      expect(readdirSync(fixture.root), "Неверный input не оставляет setup ресурсов").toEqual([])
    } finally {fixture.cleanup()}
  })

  test.each([-1, Infinity, NaN, 0.5])("Неверный maxResultBytes %s не создаёт job", async maxResultBytes => {
    const fixture = prepareWorkerFixture()
    let called = false
    try {
      await expect(runBuildWorker({...fixture.input, maxResultBytes, createJob() {
        called = true
        return {}
      }}), "Result limit проверяется до spawn").rejects.toBeInstanceOf(RangeError)
      expect(called, "Неверный предел не запускает подготовку задачи").toBeFalse()
    } finally {fixture.cleanup()}
  })

  test("Предварительная отмена сохраняет точную причину без setup", async () => {
    const fixture = prepareWorkerFixture()
    const cause = new Error("already cancelled")
    fixture.controller.abort(cause)
    let called = false
    try {
      await expect(runBuildWorker({...fixture.input, createJob() {
        called = true
        return {}
      }}), "Уже отменённый signal сохраняет исходную причину").rejects.toBe(cause)
      expect(called, "Отмена до запуска не создаёт job").toBeFalse()
      expect(readdirSync(fixture.root), "Pre-spawn abort не оставляет каталог запуска").toEqual([])
    } finally {fixture.cleanup()}
  })

  test("Malformed signal отклоняется до setup", async () => {
    const fixture = prepareWorkerFixture()
    try {
      await expect(runBuildWorker({...fixture.input, signal: {} as AbortSignal}), "Signal без штатного addEventListener не оставляет spawn без ожидания").rejects.toThrow("AbortSignal")
      expect(readdirSync(fixture.root), "Сбой контракта signal не создаёт рабочую область").toEqual([])
    } finally {fixture.cleanup()}
  })
})
