import {mkdtempSync, realpathSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import type {BuildWorkerEvent, BuildWorkerInput} from "../index"

export type WorkerFixtureJob = Readonly<{
  records?: readonly ("ready" | "wrong-nonce" | "wrong-pid" | "phase" | "unknown" | "malformed" | "empty")[]
  tail?: boolean
  result?: unknown
  resultMode?: "missing" | "invalid" | "large" | "metadata"
  stderr?: string
  exitCode?: number
  hold?: boolean
  ignoreTerm?: boolean
  descendantPath?: string
  floodBytes?: number
}>

/** Подготавливает только изолированные данные и среду; проверки остаются у spec/test. */
export function prepareWorkerFixture(job: WorkerFixtureJob = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "build-worker-test-")))
  const controller = new AbortController()
  const input: BuildWorkerInput<WorkerFixtureJob, string> = {
    entryPath: join(import.meta.dir, "worker.ts"),
    cwd: root,
    temporaryRoot: root,
    signal: controller.signal,
    timeoutMs: 5_000,
    label: "Fixture worker",
    streamMode: "strict",
    createJob: () => job,
    parseEvent: parseFixtureEvent,
  }
  return {root, controller, input, cleanup: () => rmSync(root, {recursive: true, force: true})}
}

/** Пример owner-specific parser: исполнитель не знает строкового payload. */
export function parseFixtureEvent(value: unknown): BuildWorkerEvent<string> | null {
  if (value === null || typeof value !== "object") return null
  const event = value as Record<string, unknown>
  if (event.kind === "ready" && typeof event.workerId === "string" && Number.isSafeInteger(event.pid)) {
    return {kind: "ready", workerId: event.workerId, pid: Number(event.pid)}
  }
  if (event.kind === "phase" && typeof event.event === "string") return {kind: "phase", event: event.event}
  return null
}

/** Проверяет существование только точного PID, созданного текущим тестом. */
export function fixtureProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
    throw error
  }
}
