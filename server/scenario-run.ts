import {resolve} from "node:path"
import {readScenario, type ReadScenarioInput, type ReadScenarioOutput} from "@archetypes/specs/scenarios"
import type {ExternalStorybookRegistrySnapshot} from "../catalog/registry"
import type {ExternalStorybookSessionManager} from "../sessions/session-manager"

/** Адрес варианта в проверенной ревизии; произвольные пути файлов браузер не передаёт. */
export interface StorybookScenarioRunInput {
  nodeId: string
  revision: string
  variantId: string
  props: Readonly<Record<string, unknown>>
}

/** Последовательно выполняет новые тестовые запуски, не сохраняя их результаты в кэше ревизий. */
export function createStorybookScenarioRunner() {
  let tail: Promise<unknown> = Promise.resolve()
  return (
    input: StorybookScenarioRunInput,
    packageId: string,
    snapshot: ExternalStorybookRegistrySnapshot,
    sessions: ExternalStorybookSessionManager,
    signal: AbortSignal,
    onProgress?: ReadScenarioInput["onProgress"],
  ) => {
    onProgress?.({phase: "queued"})
    const execute = async () => {
      signal.throwIfAborted()
      const node = snapshot.graph.nodes.find(node => node.id === input.nodeId && node.packageId === packageId)
      if (node?.scenarioSpec === undefined) throw new Error("Сценарий не принадлежит выбранному пакету")
      const directory = sessions.session(packageId).revisionDirectory(input.revision)
      if (directory === null) throw new Error("Ревизия сценария больше не доступна")
      const file = Bun.file(resolve(directory, "scenarios", `${encodeURIComponent(node.id)}.json`))
      if (!await file.exists()) throw new Error("В ревизии нет подготовленного сценария")
      const prepared = await file.json() as ReadScenarioOutput
      if (!node.scenarioSpec.sourcePaths.includes(prepared.path)) throw new Error("Источник сценария принадлежит другому владельцу")
      if (prepared.preview?.kind !== "function") throw new Error("Запуск предназначен для сценариев функций")
      const variant = prepared.preview.variants.findIndex(item => item.id === input.variantId)
      if (variant < 0) throw new Error("Вариант сценария не найден")
      if (await Bun.file(prepared.path).text() !== prepared.source.text) {
        throw new Error("Сценарий изменился. Дождитесь обновления страницы")
      }
      const result = await readScenario({path: prepared.path, props: input.props, variant, signal,
        ...(onProgress === undefined ? {} : {onProgress})})
      signal.throwIfAborted()
      if (result.preview?.kind !== "function" || result.preview.variants.length !== 1) {
        throw new Error("Запуск не вернул результат выбранного варианта")
      }
      const selected = result.preview.variants[0]!
      return {
        source: selected.source,
        points: selected.points,
        calls: selected.calls,
        execution: {
          status: result.exitCode === 0 ? "passed" as const : "failed" as const,
          tests: result.tests.map(({label, status, message}) => ({label, status, message})),
        },
      }
    }
    const running = tail.then(execute)
    tail = running.catch(() => {})
    return running
  }
}
