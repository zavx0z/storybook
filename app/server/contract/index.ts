import type {StorybookAppWeb} from "@storybook-app/web"
import {type StorybookAppServerBrowser as Zavx0zStorybookBrowserLifecycleContract} from "@storybook-app-server/browser"
type StorybookBrowserLifecycle = Zavx0zStorybookBrowserLifecycleContract.Output
import {type StorybookRepoDiscovery as RepoDiscoveryContract} from "@storybook-repo/discovery"
import {type StorybookAppServerCatalog as AppServerCatalogContract} from "@storybook-app-server/catalog"
import {type StorybookAppServerSessions as AppServerSessionsContract} from "@storybook-app-server/sessions"
type StorybookCatalogResolver = (...input: RepoDiscoveryContract.Input) => Promise<RepoDiscoveryContract.Output>
type ExternalStorybookRegistry = AppServerCatalogContract.Output
type ExternalStorybookSessionManager = AppServerSessionsContract.Output
import type {StorybookAppServerState} from "@storybook-app-server/state"
import type {WebSocketData} from "./server"
import type {StorybookChatSession} from "@storybook-chat/session"

/** Контракт серверного исполнения приложения Storybook. */
export declare namespace StorybookAppServer {
  /**
  Источники и параметры запуска единственного HTTP/WebSocket-сервера.
  Отсутствующие источники берутся из действующих владельцев приложения.

  @property [buildWeb] - Подготовка Web средствами выбранного исполнителя; по умолчанию worker владельца Web.

  @property createWeb - Создаёт жизненный цикл Web; приложение передаёт свою реализацию при композиции сервера.

  @property [onStartupPhase] - Получает этапы catalog, sessions, listen,
  publication и ready до возврата сервера; исключение отменяет запуск.

  @property project - Точный Git-корень Project с именем в package.json
  и составом Repo в .gitmodules; отдельный список подключений не хранится.

  @property [resolveCatalog] - Источник нормализованного каталога;
  при отсутствии используется действующий discovery.

  @property [hostname] - Адрес слушателя; по умолчанию loopback `127.0.0.1`.

  @property [port] - Порт слушателя; по умолчанию `0` для выбора свободного.

  @property [toolRoot] - Канонический checkout Storybook для ресурсов и digest.

  @property [statePath] - Приватный файл identity daemon.

  @property [artifactRoot] - Корень опубликованных и временных артефактов.

  @property [landingEntryPath] - Вход общей страницы при проверке Web-сборки.

  @property [fallbackEntryPath] - Запасной вход общей страницы при проверке.

  @property [packageBrowserEntryPath] - Вход package host при явной подстановке.

  @property [browserLifecycle] - Подготовленный контроллер browser views;
  сервер использует его до `stop` и освобождает свои session grants.

  @property [browserStateRoot] - Файлы browser lifecycle рядом с state.

  @property [captureRoot] - Каталог снимков browser lifecycle.

  @property [writeServerRecord] - Подставленная запись приватного server state;
  при отсутствии используется атомарная запись владельца {@link StorybookAppServerState.Output}.

  @property [startLease] - Поколение запуска; публикация кандидата ожидает
  подтверждения управляющего процесса перед состоянием ready.

  @property [migrateChats] - Явный переход адресов бесед приложения до открытия listener.
  Ошибка сохраняет истории и отменяет запуск; callback не отправляет сообщения агенту.

  @property [previousAddress] - Разрешает прежний пользовательский адрес в существующий адрес текущего каталога.
  Возвращаемый путь проверяется сервером; query сохраняется отдельно.
  */
  type Input = Readonly<{
    createWeb: typeof import("@storybook-app/web").default
    buildWeb?: StorybookAppWeb.Input["build"]
    /** Исполнитель явной подготовки платформы, отдельно от Web Build. */
    preparePlatform?: StorybookAppWeb.Input["preparePlatform"]
    onStartupPhase?: (phase: "catalog" | "sessions" | "listen" | "publication" | "ready") => void
    project: string
    resolveCatalog?: StorybookCatalogResolver
    hostname?: string
    port?: number
    toolRoot?: string
    statePath?: string
    artifactRoot?: string
    landingEntryPath?: string
    fallbackEntryPath?: string
    packageBrowserEntryPath?: string
    browserLifecycle?: StorybookBrowserLifecycle
    browserStateRoot?: string
    captureRoot?: string
    writeServerRecord?: StorybookAppServerState.Output["writeExternalStorybookServerRecord"]
    startLease?: Readonly<{path: string; token: string}>
    migrateChats?(chats: StorybookChatSession.Output, graph: ReturnType<AppServerCatalogContract.Output["snapshot"]>["graph"]): Promise<void>
    previousAddress?(pathname: string, graph: ReturnType<AppServerCatalogContract.Output["snapshot"]>["graph"]): string | null
  }>

  /**
  Запущенный сервер и принадлежащий ему жизненный цикл.

  @property origin - Фактический loopback origin слушателя после `Bun.serve`.

  @property record - Приватная запись текущего instance после публикации.

  @property registry - Канонический каталог подключений этого процесса.

  @property sessions - Сессии пакетов и проверки ревизий в том же процессе.

  @property browserLifecycle - Browser views и captures, обслуживаемые этим сервером.

  @property server - Точный Bun listener для управления внутри владельца приложения.

  @property stopped - Завершается после освобождения ресурсов процесса.

  @property stop - Останавливает слушатель, Web, browser grants и сессии;
  повторный вызов разделяет то же ожидание. Ошибка освобождения отклоняет Promise.
  */
  type Output = Readonly<{
    origin: string
    record: ReturnType<StorybookAppServerState.Output["readExternalStorybookServerRecord"]>
    registry: ExternalStorybookRegistry
    sessions: ExternalStorybookSessionManager
    browserLifecycle: StorybookBrowserLifecycle
    server: Bun.Server<WebSocketData>
    stopped: Promise<void>
    stop(): Promise<void>
  }>
}
