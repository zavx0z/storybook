import type {PackageRevision} from "@package/revision"
import type {RepoDiscovery} from "@repo/discovery"
import type {PackageSession} from "@package/session"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot, ExternalStorybookRegistryDirtySnapshot, ExternalStorybookRegistryMetrics} from "./models"

/** Контракт атомарного каталога подключённых владельцев приложения. */
export declare namespace AppServerCatalog {
  /**
  По умолчанию обнаружение, TypeScript-анализ, граф и описания выполняются в native worker.
  Явный resolver подставляет локальное исполнение для специализированного источника или проверки.
  Стили читаются при обновлении; ошибка сохраняет действующий снимок.
  */
  type Input = readonly [
    resolveCatalog?: (...input: RepoDiscovery.Input) => Promise<RepoDiscovery.Output>,
    readAuthorStyleSheets?: () => NonNullable<Parameters<PackageRevision.Output["create"]>[3]>,
  ]

  /**
  Управление составом и наблюдаемой актуальностью каталога.
  @property snapshot - Читает текущий снимок без обнаружения или сборки.
  @property configure - Атомарно заменяет выбранный набор корней после успешного чтения.
  @property attach - Подключает один корень, сохраняя остальных владельцев.
  @property attachMany - Подключает набор корней одной операцией.
  @property detach - Удаляет выбранную ветвь каталога, не удаляя файлов.
  @property refresh - Явно запрашивает полное обновление источников.
  @property markDirty - Отмечает точные пути для следующего условного обновления.
  @property dirtySnapshot - Читает причины необходимого обновления.
  @property metrics - Читает число обнаружений, изменений графа и попаданий кэша.
  @property refreshIfNeeded - Обновляет отмеченные источники либо возвращает имеющийся снимок.
  @property packageDescriptors - Читает дескрипторы независимых пакетных сборок.
  @property sourceRoots - Возвращает физические корни действующего состава.
  @property restore - Восстанавливает проверенный снимок и производные данные.
  */
  interface Output {
    /** Отменяет незавершённую подготовку и освобождает worker. */
    dispose(): Promise<void>
    snapshot(): ExternalStorybookRegistrySnapshot
    configure(roots: readonly string[]): Promise<ExternalStorybookRegistrySnapshot>
    attach(input: string, attachSource?: ExternalStorybookAttachSource): Promise<ExternalStorybookRegistrySnapshot>
    attachMany(inputs: readonly string[], attachSource?: ExternalStorybookAttachSource): Promise<ExternalStorybookRegistrySnapshot>
    detach(scopeId: string): Promise<ExternalStorybookRegistrySnapshot>
    refresh(): Promise<ExternalStorybookRegistrySnapshot>
    markDirty(input: string | readonly string[]): ExternalStorybookRegistryDirtySnapshot
    dirtySnapshot(): ExternalStorybookRegistryDirtySnapshot
    metrics(): ExternalStorybookRegistryMetrics
    refreshIfNeeded(): Promise<ExternalStorybookRegistrySnapshot>
    packageDescriptors(): readonly PackageSession.Input[0][]
    sourceRoots(): Promise<readonly string[]>
    restore(snapshot: ExternalStorybookRegistrySnapshot): void
  }
}
