/**
Связывает вызовы с группами и асинхронными тестами.
Группа передаётся вложенным тестам через замыкание конкретного варианта.
AsyncLocalStorage сохраняет выполнение describe и test, в том числе после await.
Нативные registrars выполняются в исходном контексте runner; callbacks возвращаются в контекст вызвавшего кода.

@packageDocumentation
*/
import {AsyncLocalStorage} from "node:async_hooks"
import {observeExpect} from "./assertions"
import {observeMatcher} from "./matcher-metadata"
import {addGroup, addTest, condition, declare, rootContext, type Declaration, type GroupContext} from "./records"

type TraceContext = GroupContext

const context = new AsyncLocalStorage<TraceContext>()
// Регистрация Bun внутри добавленного ALS нарушает обработку each; данные аргументов при этом вычисляются снаружи.
const registerInRunnerContext = AsyncLocalStorage.snapshot()
const eachTables = new Map<string, {readonly rows: readonly unknown[], index: number}>()

/** Подставляет поля строки each в шаблон названия без изменения таблицы. */
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

interface TraceRuntime {
  native(original: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown
  expect: typeof observeExpect
  matcher: typeof observeMatcher
  condition: typeof condition
  testRegistrar(declaration: Declaration, parent: TraceContext | undefined, original: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown
  /** Сохраняет объявление и оставляет вызов регистратора в исходной синтаксической позиции. */
  register(declaration: Declaration, original: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown
  /** Сохраняет таблицу each до вызова параметризованного регистратора. */
  table(site: string, rows: readonly unknown[]): readonly unknown[]
  /** Передаёт выбранную группу в замыкание вложенных тестов. */
  describe(site: string, name: unknown, callback: (group: TraceContext) => unknown, parent?: TraceContext): unknown
  /** Выбирает имя очередного варианта и сохраняет его отдельно от остальных. */
  describeEach(site: string, name: unknown, callback: (group: TraceContext) => unknown, parent?: TraceContext): unknown
}

let synchronousContext: TraceContext | undefined

/** Потребляет следующую строку each в порядке регистрации Bun. */
function takeEachCase(site: string, name: unknown) {
  const table = eachTables.get(site)
  if (!table) throw new Error(`Не зарегистрирована each table ${site}`)
  const row = table.rows[table.index++]
  return {label: renderName(name, [row]), row}
}

/** Методы, вызываемые вставками AST; исходные registrars Bun остаются без подмены. */
export const runtime: TraceRuntime = {
  native(original) {
    const wrap = (target: (...args: unknown[]) => unknown, receiver?: unknown): typeof target => new Proxy(target, {
      get(object, key) {
        const value = registerInRunnerContext(() => Reflect.get(object, key, object))
        return typeof value === "function" ? wrap(value, object) : value
      },
      apply(object, thisArg, args) {
        const caller = AsyncLocalStorage.snapshot()
        const position = typeof args[0] === "function" ? 0 : typeof args[1] === "function" ? 1 : -1
        const prepared = [...args]
        if (position >= 0) {
          const callback = args[position] as (...values: unknown[]) => unknown
          const bound = function(this: unknown, ...values: unknown[]) {
            return caller(() => Reflect.apply(callback, this, values))
          }
          Object.defineProperty(bound, "length", {value: callback.length})
          prepared[position] = bound
        }
        const value = registerInRunnerContext(() => Reflect.apply(object, receiver ?? thisArg, prepared))
        return typeof value === "function" ? wrap(value as typeof target) : value
      },
    })
    return wrap(original)
  },
  expect: observeExpect,
  matcher: observeMatcher,
  condition,
  register(declaration, original) {
    declare(declaration)
    return original
  },
  testRegistrar(declaration, parent = rootContext, original) {
    declare(declaration)
    return (...args: unknown[]) => {
      const [label, callback, ...options] = args
      if (typeof callback !== "function") return Reflect.apply(original, undefined, args)
      const rows = declaration.each ? eachTables.get(declaration.site)?.rows ?? [] : [undefined]
      const candidates = rows.map(row => ({
        args: declaration.each ? (Array.isArray(row) ? row : [row]) : [],
        test: addTest(declaration, declaration.each ? renderName(label, [row]) : String(label), parent),
        used: false,
      }))
      const wrapped = function(this: unknown, ...values: unknown[]) {
          const candidate = candidates.find(item => !item.used && item.args.every((value, index) => Object.is(value, values[index])))
          if (!candidate) throw new Error(`Не найден вариант теста ${String(label)}`)
          candidate.used = true
          return context.run({...parent, test: candidate.test.label, testId: candidate.test.id}, () => Reflect.apply(callback, this, values))
      }
      Object.defineProperty(wrapped, "length", {value: callback.length})
      return Reflect.apply(original, undefined, [label, wrapped, ...options])
    }
  },
  table(site, rows) {
    eachTables.set(site, {rows, index: 0})
    return rows
  },
  describe(site, name, callback, parent = rootContext) {
    const selected = addGroup(site, String(name), parent, null)
    const previous = synchronousContext
    synchronousContext = selected
    try {
      return context.run(selected, () => callback(selected))
    } finally {
      synchronousContext = previous
    }
  },
  describeEach(site, name, callback, parent = rootContext) {
    const selectedCase = takeEachCase(site, name)
    const selected = addGroup(site, selectedCase.label, parent, selectedCase.row)
    const previous = synchronousContext
    synchronousContext = selected
    try {
      return context.run(selected, () => callback(selected))
    } finally {
      synchronousContext = previous
    }
  },
}

/** Возвращает контекст исполняемого теста либо синхронной регистрации группы. */
export function currentContext(): TraceContext {
  return context.getStore() ?? synchronousContext ?? rootContext
}
