import {readInitialPageTarget} from "./page-target"
import {importStorybookSharedHost, readStorybookSharedHost} from "./shared-host"

/** Выбирает совместимую актуальную оболочку до первого импорта платформы. */
export async function bootstrapStorybookPage(document: Document, fetcher: typeof fetch = fetch): Promise<void> {
  const target = readInitialPageTarget(document)
  const epoch = document.querySelector<HTMLMetaElement>('meta[name="external-storybook-shared-module-epoch"]')?.content
  if (target.kind === "revision" && (!epoch || !/^[a-f0-9]{64}$/u.test(epoch))) {
    throw new Error("Старая ревизия пакета не содержит подтверждённой платформы; требуется её явная проверка")
  }
  const host = await readStorybookSharedHost(fetcher, target.readerToken, new AbortController().signal,
    target.kind === "revision" ? epoch : undefined, target.kind !== "landing" && (target.preview || target.intent === "navigation-candidate"))
  const start = await importStorybookSharedHost(host)
  await start({initialTarget: target, sharedHost: host, sharedModuleEpoch: host.sharedModuleEpoch,
    hostModuleEpoch: host.hostModuleEpoch, browserDocument: document, fetcher})
}

if (typeof document !== "undefined") {
  void bootstrapStorybookPage(document).catch(error => {
    document.documentElement.dataset.externalStorybook = "error"
    document.documentElement.dataset.externalStorybookError = error instanceof Error ? error.message : String(error)
    console.error(error)
  })
}
