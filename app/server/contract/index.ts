import type {AppWebBuild} from "@app-web/build"
import {type Zavx0zStorybookBrowserLifecycle as Zavx0zStorybookBrowserLifecycleContract} from "@zavx0z/storybook-browser-lifecycle"
type StorybookBrowserLifecycle = Zavx0zStorybookBrowserLifecycleContract.Output
import {type RepoDiscovery as RepoDiscoveryContract} from "@repo/discovery"
import {type AppServerCatalog as AppServerCatalogContract} from "@app-server/catalog"
import {type AppServerSessions as AppServerSessionsContract} from "@app-server/sessions"
type StorybookCatalogResolver = (...input: RepoDiscoveryContract.Input) => Promise<RepoDiscoveryContract.Output>
type ExternalStorybookRegistry = AppServerCatalogContract.Output
type ExternalStorybookSessionManager = AppServerSessionsContract.Output
import type {AppServerState} from "@app-server/state"
import type {WebSocketData} from "./server"

/** Контракт серверного исполнения приложения Storybook. */
export declare namespace AppServer {
  /**
  Источники и параметры запуска единственного HTTP/WebSocket-сервера.
  Отсутствующие источники берутся из действующих владельцев приложения.

  @property [buildWeb] - Подготовка Web средствами выбранного исполнителя; по умолчанию worker владельца Web.

  @property createWeb - Создаёт жизненный цикл Web; приложение передаёт свою реализацию при композиции сервера.

  @property implementationDigest - Отпечаток исполняемой среды, вычисленный лаунчером до запуска.

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
  при отсутствии используется атомарная запись владельца {@link AppServerState.Output}.

  @property [startLease] - Поколение запуска; публикация кандидата ожидает
  подтверждения управляющего процесса перед состоянием ready.
  */
  type Input = Readonly<{
    implementationDigest: string
    createWeb: typeof import("@web/release").default
    buildWeb?: AppWebBuild.Output["runWorker"]
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
    writeServerRecord?: AppServerState.Output["writeExternalStorybookServerRecord"]
    startLease?: Readonly<{path: string; token: string}>
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
    record: ReturnType<AppServerState.Output["readExternalStorybookServerRecord"]>
    registry: ExternalStorybookRegistry
    sessions: ExternalStorybookSessionManager
    browserLifecycle: StorybookBrowserLifecycle
    server: Bun.Server<WebSocketData>
    stopped: Promise<void>
    stop(): Promise<void>
  }>
}
