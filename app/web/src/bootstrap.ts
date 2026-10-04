/**
Выбирает совместимую серверную оболочку до загрузки платформы страницы.
Совместимость host и выбор kernel определяет сервер. Импорт этой возможности
не запускает страницу; автоматический cold-start принадлежит browser entry.

@packageDocumentation
*/
import WebProtocol from "@storybook-app-web/protocol"
import PageTarget from "@storybook-app-web-page/target"
import type startExternalStorybookPage from "@storybook-app-web/page"

/**
Выбирает совместимую актуальную оболочку до первого импорта платформы.

@param document - Native Document с trusted target и подтверждённой эпохой kernel.

@param fetcher - Same-origin транспорт текущего сервера.

@throws При неподтверждённой эпохе, ошибке получения или импорта host либо запуска страницы.
*/
export default async function bootstrapStorybookPage(
  document: Document,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const target = PageTarget.read(document)
  const epoch = document.querySelector<HTMLMetaElement>('meta[name="external-storybook-shared-module-epoch"]')?.content
  if (target.kind === "revision" && (!epoch || !/^[a-f0-9]{64}$/u.test(epoch))) {
    throw new Error("Старая ревизия пакета не содержит подтверждённой платформы; требуется её явная проверка")
  }
  const host = await WebProtocol.readSharedHost(fetcher, target.readerToken, new AbortController().signal,
    target.kind === "revision" ? epoch : undefined, target.kind !== "landing" && (target.preview || target.intent === "navigation-candidate"))
  const start = await WebProtocol.importSharedHost<typeof startExternalStorybookPage>(host)
  await start({initialTarget: target, sharedHost: host, sharedModuleEpoch: host.sharedModuleEpoch,
    hostModuleEpoch: host.hostModuleEpoch, browserDocument: document, fetcher})
}
