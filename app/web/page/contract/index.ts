import type {StorybookTechHmrConnection} from "@storybook-tech-hmr/connection"
import type {StorybookAppWebPagePackage} from "@storybook-app-web-page/package"
type ExternalStorybookAppliedRevision = Awaited<ReturnType<NonNullable<NonNullable<StorybookAppWebPagePackage.Input["environment"]>["loadAppliedRevision"]>>>

import type {StorybookAppWebPageShell} from "@storybook-app-web-page/shell"
type CreateExternalStorybookShellOptions = StorybookAppWebPageShell.Input
type ExternalStorybookShell = StorybookAppWebPageShell.Output
type StorybookRetainedRoot = ReturnType<StorybookAppWebPageShell.Output["releaseRoot"]>
import type startExternalStorybookPage from "../index"
import type {StorybookSharedHost, ExternalStorybookPreparedPageTarget, ExternalStorybookPagePrepareInput} from "./types"

/** Публичный контракт @web/page. */
export declare namespace StorybookAppWebPage {
  /**
  Зависимости единственного page owner.

  @property [initialTarget] - Cold target; при отсутствии читается из `external-storybook-page-target` текущего HTML.

  @property [initialPayload] - Уже импортированный payload generated package entry; исключает повторный import.

  @property [initialHistory] - При передаче управления новой платформе сохраняет семантику перехода: push для выбора пакета, replace для обновления.

  @property sharedModuleEpoch - Identity платформенных ESM owners текущей среды; определяет сохранение Root при HMR.

  @property [hostModuleEpoch] - Версия текущей общей оболочки; пакет не выбирает эту версию.

  @property [browserDocument] - Native Document страницы; semantic Document принадлежит {@link ExternalStorybookShell}.

  @property [location] - Фактический URL страницы. Новый scope получает staged adapter до успешного commit.

  @property [history] - Единственный владелец browser entries; scope не пишет сюда до commit.

  @property [fetcher] - Same-origin transport `/api/client`, prepare и reader sessions.

  @property [createSocket] - Browser socket factory для exact reader token.

  @property [shell] - Seams создания одного {@link ExternalStorybookShell}; package scopes не получают право его dispose.

  @property [retainedRoot] - Browser root той же платформы; новая App заменяет прежний интерфейс в его Document.

  @property [sharedHost] - Подтверждённая оболочка из server bootstrap или предыдущего HMR.

  @property [readSharedHost] - Transport получения текущей оболочки для точного kernel страницы.

  @property [importSharedHost] - Загрузка проверенного host module; seam для тестов.

  @property [startPackage] - Seam тестового package controller; production использует контроллер текущего host.

  @property [prepareTarget] - Server resolver target. Default вызывает {@link PageTarget.prepare}.

  @property [loadAppliedRevision] - Generic exact package/revision payload loader. Default использует {@link loadStorybookAppliedRevision}.
  */
  type Input = Readonly<{
    initialTarget?: ExternalStorybookPreparedPageTarget
    initialPayload?: ExternalStorybookAppliedRevision | null
    initialHistory?: "push" | "replace"
    sharedModuleEpoch: string
    hostModuleEpoch?: string
    browserDocument?: globalThis.Document
    location?: Pick<Location, "href" | "pathname">
    history?: Pick<History, "pushState" | "replaceState">
    fetcher?: typeof fetch
    createSocket?(url: string): StorybookTechHmrConnection.Input["socket"]
    shell?: Omit<CreateExternalStorybookShellOptions, "title" | "browserDocument" | "authorStyleSheetSources">
    retainedRoot?: StorybookRetainedRoot
    sharedHost?: StorybookSharedHost
    readSharedHost?(epoch: string | undefined, token: string, signal: AbortSignal, preview?: boolean): Promise<StorybookSharedHost>
    importSharedHost?(host: StorybookSharedHost): Promise<typeof startExternalStorybookPage>
    startPackage?: (input: StorybookAppWebPagePackage.Input) => Promise<StorybookAppWebPagePackage.Output>
    prepareTarget?(
      input: ExternalStorybookPagePrepareInput,
      signal: AbortSignal,
    ): Promise<ExternalStorybookPreparedPageTarget>
    loadAppliedRevision?(
      packageId: string,
      revision: string,
      signal: AbortSignal,
    ): Promise<ExternalStorybookAppliedRevision>
  }>

  /**
  Page-level lifecycle одного Root, Canvas и Workbench.

  @property shell - Текущая {@link ExternalStorybookShell}; сохраняется между package scopes; host-обновление заменяет её App в том же Browser root.

  @property packageId - Текущий committed package либо `null` на landing.

  @property route - Committed package route или landing pathname.

  @property navigatePackage - Сериализует prepare, scoped teardown, mount и history commit.

  @property navigateLanding - Заменяет package scope landing scope без замены shell.

  @property dispose - Abort-ит transition, освобождает текущий scope, styles, bridge и затем shell.
  */
  type Output = Readonly<{
    shell: ExternalStorybookShell
    get packageId(): string | null
    get route(): string
    navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void>
    navigateLanding(pathname?: string): Promise<void>
    dispose(): Promise<void>
  }>
}
