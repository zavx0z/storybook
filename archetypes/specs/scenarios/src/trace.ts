/**
Управляет дочерним Bun и получает завершённую историю через IPC.

@packageDocumentation
*/
import {resolve} from "node:path"
import {discover} from "./discover"
import type {ReadScenarioInput} from "../contract/input"
import type {TraceCall, ReadScenarioOutput} from "../contract/output"

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
export async function traceScenario(input: ReadScenarioInput): Promise<ReadScenarioOutput> {
  const path = resolve(input.path)
  const configuration = await discover(path)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STORYBOOK_TRACE_CONFIG: Buffer.from(JSON.stringify(configuration)).toString("base64url"),
  }
  delete env.BUN_INSPECT
  delete env.BUN_INSPECT_NOTIFY

  const calls: TraceCall[] = []
  let complete = false
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--preload", resolve(import.meta.dir, "trace-preload.ts"), path],
    cwd: configuration.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
    ipc(message, subprocess) {
      if (isTraceCallMessage(message)) calls.push(message.call)
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
  calls.sort((left, right) => left.id - right.id)
  return {path, exitCode, stdout, stderr, calls}
}
