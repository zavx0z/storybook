import type {StorybookPackageRevision} from "@zavx0z/storybook-package-revision"
import type {StorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"
import type {StorybookPackageSession} from "@zavx0z/storybook-package-session"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot, ExternalStorybookRegistryDirtySnapshot, ExternalStorybookRegistryMetrics} from "./models"

/** Контракт атомарного каталога подключённых владельцев приложения. */
export declare namespace StorybookAppServerCatalog {
  /**
  По умолчанию обнаружение, TypeScript-анализ, граф и описания выполняются в native worker.
  Явный resolver подставляет локальное исполнение для специализированного источника или проверки.
  Стили читаются при обновлении; ошибка сохраняет действующий снимок.
  */
  type Input = readonly [
    resolveCatalog?: (...input: StorybookPackageMetadataCollect.Input) => Promise<StorybookPackageMetadataCollect.Output>,
    readAuthorStyleSheets?: () => NonNullable<Parameters<StorybookPackageRevision.Output["create"]>[3]>,
  ]

  /**
  Управление составом и наблюдаемой актуальностью каталога.
  @property snapshot - После open читает дерево Project с ФС и предоставляет данные владельцев по обращению к полям, без обнаружения или сборки.
  @property open - Открывает дерево и данные Project с файловой системы, выполняя первичный сбор только при их отсутствии.
  @property saveMetadata - Сохраняет собранные сведения в meta/data пакетов и дерево в meta/data Project; в файловом режиме обновляет только имя Project.
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
    open(project: Readonly<{root: string, name: string}>, roots: readonly string[]): Promise<ExternalStorybookRegistrySnapshot>
    saveMetadata(project: Readonly<{root: string, name: string}>): Promise<Readonly<{owners: number, changed: number}>>
    configure(roots: readonly string[]): Promise<ExternalStorybookRegistrySnapshot>
    attach(input: string, attachSource?: ExternalStorybookAttachSource): Promise<ExternalStorybookRegistrySnapshot>
    attachMany(inputs: readonly string[], attachSource?: ExternalStorybookAttachSource): Promise<ExternalStorybookRegistrySnapshot>
    detach(scopeId: string): Promise<ExternalStorybookRegistrySnapshot>
    refresh(): Promise<ExternalStorybookRegistrySnapshot>
    markDirty(input: string | readonly string[]): ExternalStorybookRegistryDirtySnapshot
    dirtySnapshot(): ExternalStorybookRegistryDirtySnapshot
    metrics(): ExternalStorybookRegistryMetrics
    refreshIfNeeded(): Promise<ExternalStorybookRegistrySnapshot>
    packageDescriptors(): readonly StorybookPackageSession.Input[0][]
    sourceRoots(): Promise<readonly string[]>
    restore(snapshot: ExternalStorybookRegistrySnapshot): void
  }
}
