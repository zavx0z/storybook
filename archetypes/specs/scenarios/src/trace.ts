/**
Управляет дочерним Bun и получает завершённую историю через IPC.

@packageDocumentation
*/
import {resolve} from "node:path"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {applyReport} from "./report"
import {discover} from "./discover"
import type {ReadScenarioInput} from "../contract/input"
import type {ScenarioAssertion, ScenarioExecution, ScenarioGroup, ScenarioTest, TraceCall} from "./types"

interface TraceCallMessage {
  readonly type: "storybook:trace-call"
  readonly call: TraceCall
}

interface TraceCompleteMessage {
  readonly type: "storybook:trace-complete"
}

/** Проверяет вид IPC сообщения перед добавлением записи в отчёт. */
function isTraceCallMessage(value: unknown): value is TraceCallMessage {
  return typeof value === "object" && value !== null
    && Reflect.get(value, "type") === "storybook:trace-call"
    && typeof Reflect.get(value, "call") === "object"
}

/** Распознаёт запрос подтверждения перед выходом дочернего процесса. */
function isTraceCompleteMessage(value: unknown): value is TraceCompleteMessage {
  return typeof value === "object" && value !== null
    && Reflect.get(value, "type") === "storybook:trace-complete"
}

/**
Запускает сценарий с автоматически определёнными импортами и preload его пакета.
Инструментирует код только в дочернем процессе, не изменяя файл на диске.

@param input - Путь к исполняемому сценарию.
@returns Вызовы с аргументами, исходами и контекстом Bun Test.
@throws Ошибка определения среды, запуска или получения завершающего отчёта.
*/
export async function traceScenario(input: ReadScenarioInput): Promise<ScenarioExecution> {
  const path = resolve(input.path)
  const configuration = await discover(path)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  }
  delete env.BUN_INSPECT
  delete env.BUN_INSPECT_NOTIFY

  const calls: TraceCall[] = []
  let assertions: readonly ScenarioAssertion[] = []
  let groups: readonly ScenarioGroup[] = []
  let tests: readonly ScenarioTest[] = []
  let complete = false
  const directory = await mkdtemp(resolve(tmpdir(), "scenario-report-"))
  const reportPath = resolve(directory, "report.xml")
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--reporter=junit", "--reporter-outfile", reportPath, "--preload", resolve(import.meta.dir, "trace-preload.ts"), path,
        ...(input.testNamePattern === undefined ? [] : ["--test-name-pattern", input.testNamePattern])],
      cwd: configuration.cwd,
      env,
      stdin: new Blob([JSON.stringify({configuration, ...(input.props === undefined ? {} : {props: input.props})})]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      ipc(message, subprocess) {
        if (isTraceCallMessage(message)) calls.push(message.call)
        if (typeof message === "object" && message !== null
          && Reflect.get(message, "type") === "storybook:assertions"
          && Array.isArray(Reflect.get(message, "assertions"))) {
          assertions = Reflect.get(message, "assertions")
        }
        if (typeof message === "object" && message !== null && Reflect.get(message, "type") === "storybook:records") {
          groups = Reflect.get(message, "groups")
          tests = Reflect.get(message, "tests")
        }
        if (isTraceCompleteMessage(message)) {
          complete = true
          subprocess.send({type: "storybook:trace-ack"})
        }
      },
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (!complete) throw new Error(`Не получен завершающий IPC report: ${stderr}`)
    const junit = await readFile(reportPath, "utf8").catch(error => { throw new Error(`Не прочитан JUnit: ${stderr}`, {cause: error}) })
    calls.sort((left, right) => left.id - right.id)
    return {path, exitCode, stdout, stderr, calls, assertions, groups, tests: applyReport(junit, groups, tests), junit}
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}
