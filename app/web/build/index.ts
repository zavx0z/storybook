/**
Готовит статичную Web-оболочку на проверенной общей среде и сохраняет её ревизии.
Сборка, worker, кэш и receipt используют один Web-владелец и точные исходные входы.

@packageDocumentation
*/
import {StorybookSharedBrowserAssets} from "./src/assets"
import {buildSharedBrowserAssets} from "./src/browser-build"
import {runSharedBrowserBuild} from "./src/builder"
import {
  readSharedBrowserReceipt,
  readPublishedSharedBrowserReceipt,
  saveSharedBrowserCandidate,
  readSharedBrowserEpoch,
  saveSharedBrowserReceipt,
} from "./src/receipt"
import {readWorkbenchStyleSheets} from "./src/theme"
import {sources} from "./src/sources"
import type {AppWebBuild} from "./contract"
import type {PrepareInput, PreparedResult} from "./contract/prepare"

export type {AppWebBuild} from "./contract"

/** Проверяет отмену вокруг подготовки и сохраняет версии ровно этого кандидата. */
async function prepare<Prepared, Version extends object>(
  input: PrepareInput<Prepared, Version>,
  signal: AbortSignal,
): Promise<PreparedResult<Prepared, Version>> {
  signal.throwIfAborted()
  const candidate = await input.prepare(signal)
  signal.throwIfAborted()
  const versions = Object.freeze(input.versions(candidate).map(version => Object.freeze({...version})))
  return Object.freeze({candidate, versions})
}

/** Подготовка Web и управление уже созданными ресурсами общей оболочки. */
const build: AppWebBuild.Output = Object.freeze({
  sources,
  prepare,
  Assets: StorybookSharedBrowserAssets,
  buildAssets: buildSharedBrowserAssets,
  runWorker: runSharedBrowserBuild,
  readReceipt: readSharedBrowserReceipt,
  readPublishedReceipt: readPublishedSharedBrowserReceipt,
  saveCandidate: saveSharedBrowserCandidate,
  readEpoch: readSharedBrowserEpoch,
  saveReceipt: saveSharedBrowserReceipt,
  readTheme: readWorkbenchStyleSheets,
})

export default build
