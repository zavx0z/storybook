/**
Собирает Web-оболочку и атомарно публикует готовый результат.
Ошибка подготовки сохраняет ранее опубликованные ресурсы.

@packageDocumentation
*/
import {StorybookSharedBrowserAssets} from "./src/assets"
import {buildSharedBrowserAssets} from "./src/browser-build"
import {runSharedBrowserBuild} from "./src/builder"
import {
  readPublishedSharedBrowserReceipt,
  saveSharedBrowserCandidate,
  readSharedBrowserEpoch,
  saveSharedBrowserReceipt,
} from "./src/receipt"
import {readWorkbenchStyleSheets} from "./src/theme"
import {sources} from "./src/sources"
import type {Zavx0zStorybookAppWebBuild} from "./contract"
import type {PrepareInput, PreparedResult} from "./contract/prepare"

export type {Zavx0zStorybookAppWebBuild} from "./contract"

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
const build: Zavx0zStorybookAppWebBuild.Output = Object.freeze({
  sources,
  prepare,
  Assets: StorybookSharedBrowserAssets,
  buildAssets: buildSharedBrowserAssets,
  runWorker: runSharedBrowserBuild,
  readPublishedReceipt: readPublishedSharedBrowserReceipt,
  saveCandidate: saveSharedBrowserCandidate,
  readEpoch: readSharedBrowserEpoch,
  saveReceipt: saveSharedBrowserReceipt,
  readTheme: readWorkbenchStyleSheets,
})

export default build
