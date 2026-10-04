import {type StorybookAppWebPagePackageScenarioModel as ScenarioModelContract} from "@storybook-app-web-page-package-scenario/model"
type ScenarioAppInput = ScenarioModelContract.Input
import ArchetypesScenarioReaderOwner, {type StorybookSpecsScenariosReader as ArchetypesScenarioReaderContract} from "@storybook-specs-scenarios/reader"
import {type StorybookAppServerCatalog as AppServerCatalogContract} from "@storybook-app-server/catalog"
import {type StorybookAppServerSessions as AppServerSessionsContract} from "@storybook-app-server/sessions"
const readScenario = ArchetypesScenarioReaderOwner
type ReadScenarioInput = ArchetypesScenarioReaderContract.Input
type ReadScenarioOutput = ArchetypesScenarioReaderContract.Output
type ExternalStorybookRegistrySnapshot = ReturnType<AppServerCatalogContract.Output["snapshot"]>
type ExternalStorybookSessionManager = AppServerSessionsContract.Output
import {resolve} from "node:path"

/** Адрес варианта в проверенной ревизии; rerun явно запрашивает новый тест. */
export interface StorybookScenarioRunInput {
  nodeId: string
  revision: string
  variantId: string
  props: Readonly<Record<string, unknown>>
  rerun?: boolean
}

type Result = Awaited<ReturnType<NonNullable<ScenarioAppInput["run"]>>>
type Progress = NonNullable<ReadScenarioInput["onProgress"]>
type Run = {
  controller: AbortController
  result: Promise<Result>
  settled: boolean
  listeners: Set<Progress>
  progress: Parameters<Progress>[0]
}

/**
Возвращает результат из отчёта отображаемой ревизии. Изменённые props и явный rerun
выполняются последовательно; одинаковые запросы разделяют прогон и его результат.
Отмена читателя отсоединяет его от прогона. dispose освобождает очередь и кэш.
*/
export function createStorybookScenarioRunner(read: (input: ReadScenarioInput) => Promise<ReadScenarioOutput> = readScenario) {
  let tail: Promise<unknown> = Promise.resolve()
  const runs = new Map<string, Run>()
  let disposed = false
  const run = async (
    input: StorybookScenarioRunInput,
    packageId: string,
    snapshot: ExternalStorybookRegistrySnapshot,
    sessions: ExternalStorybookSessionManager,
    signal: AbortSignal,
    onProgress?: Progress,
  ): Promise<Result> => {
    signal.throwIfAborted()
    if (disposed) throw new Error("Исполнение сценариев завершено")
    const node = snapshot.graph.nodes.find(node => node.id === input.nodeId && node.packageId === packageId)
    if (node?.scenarioSpec === undefined) throw new Error("Сценарий не принадлежит выбранному пакету")
    const session = sessions.session(packageId)
    const directory = session.revisionDirectory(input.revision)
    if (directory === null) throw new Error("Ревизия сценария больше не доступна")
    const file = Bun.file(resolve(directory, "scenarios", `${encodeURIComponent(node.id)}.json`))
    if (!await file.exists()) throw new Error("В ревизии нет подготовленного сценария")
    const prepared = await file.json() as ReadScenarioOutput
    signal.throwIfAborted()
    if (disposed) throw new Error("Исполнение сценариев завершено")
    if (!node.scenarioSpec.sourcePaths.includes(prepared.path)) throw new Error("Источник сценария принадлежит другому владельцу")
    if (prepared.preview === undefined) throw new Error("В ревизии нет представления сценария")
    const variantIndex = prepared.preview.variants.findIndex(item => item.id === input.variantId)
    const variant = prepared.preview.variants[variantIndex]
    if (variant === undefined) throw new Error("Вариант сценария не найден")
    const key = JSON.stringify([packageId, input.revision, input.nodeId, input.variantId, propsKey(input.props)])
    const existing = runs.get(key)
    if (existing !== undefined && (!input.rerun || !existing.settled)) return observeRun(existing, signal, onProgress)
    if (!input.rerun && propsKey(input.props) === propsKey(variant.props ?? {})) {
      const result = scenarioResult(prepared, variant)
      if (result.execution.tests.length > 0 && !result.execution.tests.some(test => test.status === "not-executed")) return result
    }

    const entry: Run = {controller: new AbortController(), result: undefined!, settled: false,
      listeners: new Set(), progress: {phase: "queued"}}
    const notify: Progress = progress => {
      entry.progress = {phase: progress.phase, text: ((entry.progress.text ?? "") + (progress.text ?? "")).slice(-262_144)}
      for (const listener of entry.listeners) {
        try { listener(progress) } catch { /* Читатель не меняет исход теста. */ }
      }
    }
    const execute = async () => {
      entry.controller.signal.throwIfAborted()
      const selection = "selection" in variant ? variant.selection : undefined
      const report = await read({path: prepared.path, props: input.props,
        ...(selection === undefined ? {variant: variantIndex} : {variantPath: selection}),
        signal: entry.controller.signal, onProgress: notify})
      entry.controller.signal.throwIfAborted()
      if (report.preview?.kind !== prepared.preview!.kind || report.preview.variants.length !== 1) {
        throw new Error("Запуск не вернул результат выбранного варианта")
      }
      const result = scenarioResult(report, report.preview.variants[0]!)
      if ((result.execution.tests.length === 0 || result.execution.tests.some(test => test.status === "not-executed"))
        && runs.get(key) === entry) runs.delete(key)
      return result
    }
    entry.result = tail.then(execute).then(result => {
      entry.settled = true
      return result
    }, error => {
      if (runs.get(key) === entry) runs.delete(key)
      throw error
    })
    tail = entry.result.catch(() => {})
    runs.set(key, entry)
    while (runs.size > 64) {
      const oldest = runs.keys().next().value!
      runs.get(oldest)!.controller.abort(new DOMException("Освобождён старый прогон сценария", "AbortError"))
      runs.delete(oldest)
    }
    return observeRun(entry, signal, onProgress)
  }
  return Object.assign(run, {
    async dispose() {
      disposed = true
      for (const entry of runs.values()) entry.controller.abort(new DOMException("Storybook завершает работу", "AbortError"))
      runs.clear()
      await tail
    },
  })
}

/** Порядок JSON-полей не меняет входы прогона. */
function propsKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}

/** Выбирает проверки варианта вместе с его вложенными темами, сохраняя исходные статусы. */
function scenarioResult(report: ReadScenarioOutput, variant: NonNullable<ReadScenarioOutput["preview"]>["variants"][number]): Result {
  const groups = new Set([Number(variant.id)])
  for (const group of report.groups) if (group.parentId !== null && groups.has(group.parentId)) groups.add(group.id)
  const tests = report.tests.filter(test => test.groupId !== null && groups.has(test.groupId))
  const passed = report.exitCode === 0 && tests.some(test => test.status === "passed")
    && !tests.some(test => test.status === "failed" || test.status === "error" || test.status === "not-executed")
  return {
    source: variant.source, points: variant.points, calls: "calls" in variant ? variant.calls : [],
    ...("props" in variant && variant.props !== undefined && report.preview?.kind === "component" ? {props: variant.props} : {}),
    execution: {
      status: passed ? "passed" : "failed",
      ...(tests.some(test => test.status === "passed") ? {} : {message: "В выбранном варианте нет успешных проверок"}),
      tests: tests.map(({label, status, message}) => ({label, status, message})),
    },
  }
}

/** Читатель может отменить ожидание; общий прогон остаётся доступен другим читателям. */
function observeRun(entry: Run, signal: AbortSignal, onProgress?: Progress): Promise<Result> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const clear = () => {
      signal.removeEventListener("abort", abort)
      if (onProgress) entry.listeners.delete(onProgress)
    }
    const abort = () => { clear(); reject(signal.reason) }
    signal.addEventListener("abort", abort, {once: true})
    if (onProgress) {
      entry.listeners.add(onProgress)
      try { onProgress(entry.progress) } catch { /* Наблюдение не влияет на выполнение. */ }
    }
    entry.result.then(result => { clear(); resolve(result) }, error => { clear(); reject(error) })
  })
}
