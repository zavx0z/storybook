import {resolve} from "node:path"
import type {TraceScenarioInput} from "../contract/trace-input"
import type {TraceCall, TraceScenarioOutput} from "../contract/trace-output"

interface TraceCallMessage {
  readonly type: "storybook:trace-call"
  readonly call: TraceCall
}

interface TraceCompleteMessage {
  readonly type: "storybook:trace-complete"
}

function isTraceCallMessage(value: unknown): value is TraceCallMessage {
  return typeof value === "object" && value !== null
    && Reflect.get(value, "type") === "storybook:trace-call"
    && typeof Reflect.get(value, "call") === "object"
}

function isTraceCompleteMessage(value: unknown): value is TraceCompleteMessage {
  return typeof value === "object" && value !== null
    && Reflect.get(value, "type") === "storybook:trace-complete"
}

/**
Запускает существующий сценарий настоящим Bun Test и наблюдает выбранные exports.

Дочерний preload не подменяет lifecycle Bun Test. Runtime plugin добавляет
async context внутрь тел callbacks только в памяти дочернего процесса;
файл сценария на диске не меняется. Выбранные module exports получают
прозрачную обёртку, а завершённые наблюдения передаются по IPC.

Эксперимент распознаёт прямые `describe` и `test` с block-bodied callback,
`describe.each`, `test.each` и модификаторы вроде `test.concurrent`. Для each names
поддержаны `$field` и `$nested.field`; printf placeholders, переименованные
imports, concise arrow bodies и принадлежность вызовов из hooks пока не разрешаются.
Снимок значения читает own enumerable string fields без вызова getters;
functions, accessors, promises и циклы получают явные tagged values.

@param input - Файл теста и явный список наблюдаемых public exports.

@returns Код и вывод Bun Test вместе с вызовами после завершения всех Promise.
@throws Ошибка запуска, таймаут или отсутствие завершающего IPC report.

@example
```ts
const result = await traceScenario({
  path: "./scenario.spec.ts",
  observe: [{module: "@scope/package", exports: ["readPackage"]}],
})
```
*/
export async function traceScenario(input: TraceScenarioInput): Promise<TraceScenarioOutput> {
  const path = resolve(input.path)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STORYBOOK_TRACE_CONFIG: Buffer.from(JSON.stringify({path, observe: input.observe})).toString("base64url"),
  }
  delete env.BUN_INSPECT
  delete env.BUN_INSPECT_NOTIFY

  const calls: TraceCall[] = []
  let complete = false
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--preload", resolve(import.meta.dir, "trace-preload.ts"), path],
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
