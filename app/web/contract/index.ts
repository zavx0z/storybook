import type {StorybookTechBuildEnvironment} from "@zavx0z/storybook-tech-build-environment"
import type {StorybookAppWebBuild} from "@zavx0z/storybook-app-web-build"
import type {StorybookPackageBuildScheduler} from "@zavx0z/storybook-package-build-scheduler"
import type {StorybookPackageSession} from "@zavx0z/storybook-package-session"
import type {WebAssets, WebEvent, WebFailure, WebHost, WebPreparation, WebState} from "./types"

/** Web соединяет подготовку и выпуск текущего интерфейса приложения. */
export declare namespace StorybookAppWeb {
  /**
  Ресурсы, предоставленные приложением; создание не запускает компиляцию.

  @property toolRoot - Канонический корень установленного Storybook.

  @property artifactRoot - Общая область артефактов приложения; Web владеет её каталогом shared.

  @property scheduler - Получает общую очередь после создания частей приложения.
  Очередь и её завершение принадлежат вызывающему контейнеру.

  @property revisions - Снимки пакетных ревизий для выбора получателей обновления.
  Новая оболочка применяется автоматически только к страницам той же платформы.

  @property [publish] - Передаёт события Web транспортам приложения.

  @property [build] - Исполнитель подготовки; без подстановки используется worker владельца Build.

  @property [landingEntryPath] - Явный browser-вход для специализированной поставки или проверки.

  @property [fallbackEntryPath] - Явный browser-вход страницы без готовой пакетной ревизии.
  */
  export type Input = Readonly<{
    toolRoot: string
    artifactRoot: string
    scheduler(): StorybookPackageBuildScheduler.Output
    revisions(): readonly ReturnType<StorybookPackageSession.Output["snapshot"]>[]
    publish?(event: WebEvent): void
    build?: StorybookAppWebBuild.Output["runWorker"]
    /** Явная подготовка платформы предоставляется композицией App; rebuild её не вызывает. */
    preparePlatform?: StorybookTechBuildEnvironment.Output["runWorker"]
    landingEntryPath?: string
    fallbackEntryPath?: string
  }>

  /**
  Одна граница Web для серверной композиции и доставки браузерного результата.

  @property artifactRoot - Область immutable browser-артефактов для HTTP-доставки.

  @property packageEntryPath - Browser-вход, связывающий подготовленную ревизию пакета с этой страницей.

  @property readStyleSheets - Читает публичные авторские стили интерфейса для каталога и HTTP-доставки.

  @property platform - Последняя опубликованная платформа, если она уже подготовлена.

  @property error - Последний отказ подготовки текущей оболочки.

  @property assets - Читает опубликованные артефакты либо явного кандидата без компиляции.

  @property host - Читает готовый host точной платформы без запуска сборки.
  Старая страница сохраняет собственные файлы до явного обновления пакета.

  @property rebuild - Готовит интерфейс поверх существующей платформы и по apply публикует его.
  Конкурентные обращения присоединяются к одной операции. Публикация не подтверждает применение в браузере.

  @property check - Готовит одну текущую среду; apply публикует успешный результат.
  Сохранённые платформы не создают дополнительные проходы компиляции.

  @property read - Читает состояние выпуска интерфейса без запуска работы.

  @property subscribe - Наблюдает выпуск; отключение подписки не отменяет общую работу.

  @property canRefresh - Проверяет совпадение платформы страницы с текущей оболочкой.

  @property dispose - Отменяет подготовку и ожидает освобождение собственных исполнителей и подписок.
  Общая очередь и пакетные сессии сохраняют своих владельцев.
  */
  export type Output = Readonly<{
    artifactRoot: string
    packageEntryPath: string
    readStyleSheets(): ReturnType<StorybookAppWebBuild.Output["readTheme"]>
    readonly platform: WebAssets["browserIdentity"]
    readonly error: WebFailure | null
    assets(preview?: boolean): WebAssets
    host(epoch?: string, preview?: boolean): WebHost
    rebuild(options?: Readonly<{apply?: boolean}>): Promise<WebPreparation>
    check(options: Readonly<{apply?: boolean}>, signal: AbortSignal): Promise<WebPreparation>
    read(): WebState
    subscribe(listener: (state: WebState) => void): () => void
    canRefresh(packageId: string | null, revision: string | null): boolean
    dispose(): Promise<void>
  }>
}
