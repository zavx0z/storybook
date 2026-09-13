import {AsyncLocalStorage} from "node:async_hooks"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"
import * as bunTest from "bun:test"
import {API} from "typescript/unstable/async"
import {SyntaxKind} from "typescript/unstable/ast"
import type {
  ArrowFunction,
  CallExpression,
  Expression,
  FunctionExpression,
  Node,
} from "typescript/unstable/ast"
import {
  isArrowFunction,
  isBlock,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is"
import type {TraceModuleSelection} from "../contract/trace-input"
import type {TraceCall, TraceLocation, TraceOutcome, TraceValue} from "../contract/trace-output"

interface TraceContext {
  readonly describe: readonly string[]
  readonly test: string | null
}

const context = new AsyncLocalStorage<TraceContext>()
const pending = new Set<Promise<void>>()
const eachTables = new Map<string, {readonly rows: readonly unknown[], index: number}>()
let nextCallId = 0
let nextCompletionId = 0

function renderName(template: unknown, values: readonly unknown[]): string {
  const name = String(template)
  const first = values[0]
  if (typeof first !== "object" || first === null) return name
  return name.replace(/\$([\w.]+)/g, (_, path: string) => {
    let current: unknown = first
    for (const part of path.split(".")) {
      if (typeof current !== "object" || current === null) return `$${path}`
      current = Reflect.get(current, part)
    }
    return String(current)
  })
}

type Registrar = (...args: unknown[]) => unknown

interface TraceRuntime {
  register(site: string, parent: string | null, callback: () => unknown): unknown
  table(site: string, rows: readonly unknown[]): readonly unknown[]
  describe(site: string, name: unknown, callback: () => unknown): unknown
  describeEach(site: string, name: unknown, callback: () => unknown): unknown
  test(site: string, name: unknown, callback: () => unknown): unknown
  testEach(site: string, name: unknown, callback: () => unknown): unknown
}

const registrationContexts = new Map<string, TraceContext>()
const groupContexts = new Map<string, TraceContext>()
let synchronousContext: TraceContext | undefined

function takeEachName(site: string, name: unknown): string {
  const table = eachTables.get(site)
  if (!table) throw new Error(`Не зарегистрирована each table ${site}`)
  const row = table.rows[table.index++]
  return renderName(name, [row])
}

const runtime: TraceRuntime = {
  register(site, parent, callback) {
    registrationContexts.set(site, parent ? groupContexts.get(parent) ?? {describe: [], test: null} : {describe: [], test: null})
    return callback()
  },
  table(site, rows) {
    eachTables.set(site, {rows, index: 0})
    return rows
  },
  describe(site, name, callback) {
    const parent = registrationContexts.get(site) ?? {describe: [], test: null}
    const selected = {describe: [...parent.describe, String(name)], test: null}
    groupContexts.set(site, selected)
    const previous = synchronousContext
    synchronousContext = selected
    try {
      return callback()
    } finally {
      synchronousContext = previous
    }
  },
  describeEach(site, name, callback) {
    const parent = registrationContexts.get(site) ?? {describe: [], test: null}
    const selected = {describe: [...parent.describe, takeEachName(site, name)], test: null}
    groupContexts.set(site, selected)
    const previous = synchronousContext
    synchronousContext = selected
    try {
      return callback()
    } finally {
      synchronousContext = previous
    }
  },
  test(site, name, callback) {
    const parent = registrationContexts.get(site) ?? {describe: [], test: null}
    return context.run({describe: parent.describe, test: String(name)}, callback)
  },
  testEach(site, name, callback) {
    const parent = registrationContexts.get(site) ?? {describe: [], test: null}
    return context.run({describe: parent.describe, test: takeEachName(site, name)}, callback)
  },
}

Reflect.set(globalThis, Symbol.for("storybook.trace"), runtime)

interface Insertion {
  readonly position: number
  readonly text: string
  readonly order: number
}

function calledOwner(expression: Expression): "describe" | "test" | null {
  let current = expression
  while (isPropertyAccessExpression(current)) current = current.expression
  if (isCallExpression(current)) current = current.expression
  while (isPropertyAccessExpression(current)) current = current.expression
  return isIdentifier(current) && (current.text === "describe" || current.text === "test") ? current.text : null
}

function eachCall(expression: Expression): CallExpression | null {
  if (!isCallExpression(expression) || !isPropertyAccessExpression(expression.expression)) return null
  return expression.expression.name.text === "each" ? expression : null
}

async function instrument(path: string, source: string): Promise<string> {
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const file = await project?.program.getSourceFile(path)
    if (!file) throw new Error(`Не найден исходный файл для trace: ${path}`)
    const insertions: Insertion[] = []
    let siteIndex = 0
    const visit = (node: Node, parentGroup: string | null): void => {
      if (isCallExpression(node)) {
        const owner = calledOwner(node.expression)
        const name = node.arguments[0]
        let callback: ArrowFunction | FunctionExpression | undefined
        for (const [index, argument] of node.arguments.entries()) {
          if (index > 0 && (isArrowFunction(argument) || isFunctionExpression(argument))) callback = argument
        }
        if (owner && name && callback && isBlock(callback.body)) {
          const site = `${owner}:${siteIndex++}`
          const selectedEach = eachCall(node.expression)
          if (selectedEach?.arguments[0]) {
            insertions.push({position: selectedEach.arguments[0].getStart(file), text: `globalThis[Symbol.for("storybook.trace")].table(${JSON.stringify(site)},(`, order: 0})
            insertions.push({position: selectedEach.arguments[0].end, text: "))", order: 1})
          }
          const asynchronous = callback.modifiers?.some(modifier => modifier.kind === SyntaxKind.AsyncKeyword) ?? false
          const method = selectedEach ? `${owner}Each` : owner
          const argumentsText = `${JSON.stringify(site)},${source.slice(name.getStart(file), name.end)}`
          insertions.push({
            position: node.getStart(file),
            text: `globalThis[Symbol.for("storybook.trace")].register(${JSON.stringify(site)},${JSON.stringify(parentGroup)},()=>((`,
            order: 0,
          })
          insertions.push({position: node.end, text: ")))", order: 1})
          insertions.push({
            position: callback.body.getStart(file) + 1,
            text: `return globalThis[Symbol.for("storybook.trace")].${method}(${argumentsText},${asynchronous ? "async " : ""}()=>{`,
            order: 0,
          })
          insertions.push({position: callback.body.end - 1, text: "})", order: 1})
          node.forEachChild(child => visit(child, owner === "describe" ? site : parentGroup))
          return
        }
      }
      node.forEachChild(child => visit(child, parentGroup))
    }
    visit(file, null)
    return insertions.sort((left, right) => right.position - left.position || right.order - left.order)
      .reduce((contents, insertion) => contents.slice(0, insertion.position) + insertion.text + contents.slice(insertion.position), source)
  } finally {
    await api.close()
  }
}

function queue(task: Promise<void>): void {
  const guarded = task.finally(() => pending.delete(guarded))
  pending.add(guarded)
}

async function serialize(value: unknown, seen = new Map<object, string>(), path = "$"): Promise<TraceValue> {
  if (value === undefined) return {$type: "undefined"}
  if (typeof value === "bigint") return {$type: "bigint", value: String(value)}
  if (typeof value === "symbol") return {$type: "symbol", value: value.description ?? ""}
  if (typeof value === "function") return {$type: "function", name: value.name}
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value
  if (typeof value !== "object") return {$type: "unsupported", value: String(value)}
  const knownPath = seen.get(value)
  if (knownPath) return {$type: "reference", path: knownPath}
  const next = new Map(seen).set(value, path)
  if (value instanceof Promise) {
    try {
      return {$type: "promise", status: "fulfilled", value: await serialize(await value, next, `${path}.value`)}
    } catch (error) {
      return {$type: "promise", status: "rejected", error: await serialize(error, next, `${path}.error`)}
    }
  }
  if (value instanceof Error) return {
    $type: "error",
    name: value.name,
    message: value.message,
  }
  if (value instanceof Date) return {$type: "date", value: value.toISOString()}
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => serialize(item, next, `${path}[${index}]`)))
  const entries = await Promise.all(Object.keys(value).map(async key => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && (descriptor.get || descriptor.set)) return [key, {
        $type: "accessor",
        get: descriptor.get?.name ?? null,
        set: descriptor.set?.name ?? null,
      }] as const
      return [key, await serialize(descriptor?.value, next, `${path}.${key}`)] as const
    } catch (error) {
      return [key, {$type: "unreadable", error: await serialize(error, next, `${path}.${key}.error`)}] as const
    }
  }))
  return Object.fromEntries(entries)
}

function callLocation(stack: string | undefined): TraceLocation | null {
  for (const line of stack?.split("\n").slice(1) ?? []) {
    if (line.includes("trace-preload.ts") || line.includes("node:internal") || line.includes("bun:test")) continue
    const match = line.match(/(?:\(|at )((?:file:\/\/)?[^()]+):(\d+):(\d+)\)?$/)
    if (!match?.[1] || !match[2] || !match[3]) continue
    const path = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1]
    return {path, line: Number(match[2]), column: Number(match[3])}
  }
  return null
}

function sendCall(
  call: Omit<TraceCall, "args" | "outcome" | "completed">,
  args: Promise<readonly TraceValue[]>,
  completion: Promise<{readonly completed: number, readonly outcome: TraceOutcome}>,
): void {
  queue(Promise.all([args, completion]).then(([serializedArgs, {completed, outcome}]) => {
    process.send?.({type: "storybook:trace-call", call: {...call, completed, args: serializedArgs, outcome}})
  }))
}

function observe(module: string, name: string, original: Registrar): Registrar {
  return function(this: unknown, ...args: unknown[]) {
    const id = nextCallId++
    const active = context.getStore() ?? synchronousContext ?? {describe: [], test: null}
    const call = {
      id,
      module,
      name,
      describe: active.describe,
      test: active.test,
      location: callLocation(new Error().stack),
    }
    const serializedArgs = serialize(args) as Promise<readonly TraceValue[]>
    try {
      const result = Reflect.apply(original, this, args)
      if (result instanceof Promise) {
        const completion = result.then(
          async value => ({
            completed: nextCompletionId++,
            outcome: {type: "resolve" as const, value: await serialize(value)},
          }),
          async error => ({
            completed: nextCompletionId++,
            outcome: {type: "reject" as const, error: await serialize(error)},
          }),
        )
        sendCall(call, serializedArgs, completion)
      } else {
        const completed = nextCompletionId++
        sendCall(call, serializedArgs, serialize(result).then(value => ({
          completed,
          outcome: {type: "return" as const, value},
        })))
      }
      return result
    } catch (error) {
      const completed = nextCompletionId++
      sendCall(call, serializedArgs, serialize(error).then(value => ({
        completed,
        outcome: {type: "throw" as const, error: value},
      })))
      throw error
    }
  }
}

const encodedConfig = process.env.STORYBOOK_TRACE_CONFIG
if (!encodedConfig) throw new Error("Не задан список наблюдаемых exports")
const configuration = JSON.parse(Buffer.from(encodedConfig, "base64url").toString()) as {
  readonly path: string
  readonly observe: readonly TraceModuleSelection[]
}
const scenarioPath = resolve(configuration.path)

Bun.plugin({
  name: "storybook-scenario-trace",
  setup(build) {
    const escapedPath = scenarioPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    build.onLoad({filter: new RegExp(`^${escapedPath}$`)}, async ({path}) => {
      const source = await Bun.file(path).text()
      return {contents: await instrument(path, source), loader: path.endsWith("x") ? "tsx" : "ts"}
    })
  },
})

for (const selection of configuration.observe) {
  const module = selection.module.startsWith(".") ? resolve(selection.module) : selection.module
  const imported = await import(module) as Record<string, unknown>
  const replacement: Record<string, unknown> = {...imported}
  for (const name of selection.exports) {
    const original = imported[name]
    if (typeof original !== "function") throw new TypeError(`Export ${selection.module}:${name} не является function`)
    replacement[name] = observe(selection.module, name, original as Registrar)
  }
  await bunTest.mock.module(module, () => replacement)
}

bunTest.afterAll(async () => {
  while (pending.size > 0) await Promise.all(pending)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Не получен IPC ack")), 5_000)
    process.once("message", message => {
      if (typeof message === "object" && message !== null && Reflect.get(message, "type") === "storybook:trace-ack") {
        clearTimeout(timeout)
        resolve()
      }
    })
    process.send?.({type: "storybook:trace-complete"})
  })
})
