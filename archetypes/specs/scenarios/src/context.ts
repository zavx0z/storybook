/**
Связывает вызовы с группами и асинхронными тестами.
Группа передаётся вложенным тестам через замыкание конкретного варианта.
AsyncLocalStorage применяется к test, но не оборачивает регистрацию describe: это нарушает lifecycle Bun.

@packageDocumentation
*/
import {AsyncLocalStorage} from "node:async_hooks"

interface TraceContext {
  readonly describe: readonly string[]
  readonly test: string | null
}

const context = new AsyncLocalStorage<TraceContext>()
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
  /** Исполняет оригинальную регистрацию Bun без переноса её в AsyncLocalStorage. */
  register(site: string, parent: string | null, callback: () => unknown): unknown
  /** Сохраняет таблицу each до вызова параметризованного регистратора. */
  table(site: string, rows: readonly unknown[]): readonly unknown[]
  /** Передаёт выбранную группу в замыкание вложенных тестов. */
  describe(site: string, name: unknown, callback: (group: TraceContext) => unknown, parent?: TraceContext): unknown
  /** Выбирает имя очередного варианта и сохраняет его отдельно от остальных. */
  describeEach(site: string, name: unknown, callback: (group: TraceContext) => unknown, parent?: TraceContext): unknown
  /** Изолирует асинхронные вызовы одного теста от параллельных тестов. */
  test(site: string, name: unknown, callback: () => unknown, parent?: TraceContext): unknown
  /** Связывает асинхронные вызовы с конкретной строкой test.each. */
  testEach(site: string, name: unknown, callback: () => unknown, parent?: TraceContext): unknown
}

let synchronousContext: TraceContext | undefined

/** Потребляет следующую строку each в порядке регистрации Bun. */
function takeEachName(site: string, name: unknown): string {
  const table = eachTables.get(site)
  if (!table) throw new Error(`Не зарегистрирована each table ${site}`)
  const row = table.rows[table.index++]
  return renderName(name, [row])
}

/** Методы, вызываемые вставками AST; исходные registrars Bun остаются без подмены. */
export const runtime: TraceRuntime = {
  register(site, parent, callback) {
    return callback()
  },
  table(site, rows) {
    eachTables.set(site, {rows, index: 0})
    return rows
  },
  describe(site, name, callback, parent = {describe: [], test: null}) {
    const selected = {describe: [...parent.describe, String(name)], test: null}
    const previous = synchronousContext
    synchronousContext = selected
    try {
      return callback(selected)
    } finally {
      synchronousContext = previous
    }
  },
  describeEach(site, name, callback, parent = {describe: [], test: null}) {
    const selected = {describe: [...parent.describe, takeEachName(site, name)], test: null}
    const previous = synchronousContext
    synchronousContext = selected
    try {
      return callback(selected)
    } finally {
      synchronousContext = previous
    }
  },
  test(site, name, callback, parent = {describe: [], test: null}) {
    return context.run({describe: parent.describe, test: String(name)}, callback)
  },
  testEach(site, name, callback, parent = {describe: [], test: null}) {
    return context.run({describe: parent.describe, test: takeEachName(site, name)}, callback)
  },
}

/** Возвращает контекст исполняемого теста либо синхронной регистрации группы. */
export function currentContext(): TraceContext {
  return context.getStore() ?? synchronousContext ?? {describe: [], test: null}
}

