import type {StorybookPackageCompilerInputs, StorybookResolutionEvidence} from "./models"
import type {StorybookPackageOwner} from "./owner"

/** Публичные возможности физического разрешения и компиляции одного графа исходников. */
export declare namespace BuildCompiler {
  /**
  Точные границы подготовки compiler plugins.

  @property toolRoot - Корень установленного toolchain, выбранный вызывающим владельцем.
  @property packageRoot - Канонический корень компилируемого пакета.
  @property repo - Канонический корень Repo для разрешения исходников и зависимостей.
  Workspaces и общая цепочка tsconfig принадлежат этому Repo; адрес Project не подставляется.
  @property moduleSourcePaths - Авторские модули для определения effective JSX config.
  @property [generatedSourceRoot] - Корень подготовленных модулей текущей сборки.
  */
  type Input = Readonly<{
    toolRoot: string
    packageRoot: string
    repo: string
    moduleSourcePaths: readonly string[]
    generatedSourceRoot?: string
  }>

  /**
  Компилятор и разрешители используют одних физических владельцев.

  @property resolveStorybookCompilerSourceRoots - Читает корни объявленного графа без компиляции.
  @property resolveStorybookPackageCompilerInputs - Читает точные входы compiler setup без создания plugins.
  @property resolveStorybookCompilerControlFiles - Читает ancestor tsconfig/bunfig и extends для готовых source roots.
  @property createStorybookOwnerResolver - Создаёт resolver для того же графа владельцев.
  @property createStorybookOwnerSourcePath - Возвращает перевод подтверждённого installed mirror к каноническому исходнику.
  @property createStorybookPackageCompilerPlugins - Создаёт resolver и свежий JSX compiler plugin для входов Input.
  @property resolveStorybookJsxImportSource - Читает pragma и effective tsconfig одного исходника без загрузки compiler plugins.
  @property conditionalExportTarget - Выбирает цель exports по упорядоченным условиям среды.
  @property readStorybookPackageOwner - Находит ближайшего физического владельца файла или возвращает null.
  @property readStorybookPackageRoot - Подтверждает имя и inode манифеста заданного корня.
  @property sameStorybookPackageOwner - Сравнивает physical identity двух корней.
  @property preferredStorybookPackageRoot - Выбирает checkout среди подтверждённых spelling одного владельца.
  @property canonicalizeStorybookPackageFile - Возвращает исходник владельца; чужое происхождение отклоняется.
  @property tryCanonicalizeStorybookPackageFile - Возвращает null для чужого пакета; повреждённый mirror отклоняется.
  @property ensureGeneratedJsxProtocol - Подключает generated root к точному публичному JSX owner.
  @property isOwnedJsxProtocol - Проверяет физического владельца native JSX export.
  */
  type Output = Readonly<{
    /** Канонизирует parent directory и сохраняет spelling exact non-symlink file, включая hardlinks. */
    exactFile(path: string): string
    resolveStorybookCompilerSourceRoots(input: Readonly<{repo: string, packageRoot: string}>): readonly string[]
    /**
    Существенные manifests, selected Bun lock records и overrides фактических inputs.
    ownerRoots — необязательные доверенные canonical named owners уже выполненного resolver.
    Проверяются принадлежность каждого exact file и отсутствие пропущенного named owner;
    nameless npm scope manifests сохраняются в evidence, а не молча игнорируются.
    Без ownerRoots действует прежнее строгое обнаружение ближайшего владельца.
    Resolver fields сохраняются независимо от кешированной native import target.
    */
    readStorybookResolutionEvidence(input: Readonly<{files: readonly string[], ownerRoots?: readonly string[]}>): StorybookResolutionEvidence
    resolveStorybookPackageCompilerInputs(input: Input): StorybookPackageCompilerInputs
    resolveStorybookCompilerControlFiles(sourceRoots: readonly string[]): readonly string[]
    createStorybookOwnerResolver(input: Readonly<{repo: string, packageRoot: string}>): Bun.BunPlugin
    createStorybookOwnerSourcePath(input: Readonly<{repo: string, packageRoot: string}>): (path: string) => string
    createStorybookPackageCompilerPlugins(input: Input): Promise<readonly Bun.BunPlugin[]>
    resolveStorybookJsxImportSource(sourcePath: string): string | undefined
    conditionalExportTarget(value: unknown, conditions?: readonly string[]): string | null
    readStorybookPackageOwner(path: string): StorybookPackageOwner | null
    readStorybookPackageRoot(root: string): StorybookPackageOwner
    sameStorybookPackageOwner(leftRoot: string, rightRoot: string): boolean
    preferredStorybookPackageRoot(leftRoot: string, rightRoot: string): string
    canonicalizeStorybookPackageFile(ownerRoot: string, path: string): string
    tryCanonicalizeStorybookPackageFile(ownerRoot: string, path: string): string | null
    ensureGeneratedJsxProtocol(sourceRoot: string, toolRoot: string): void
    isOwnedJsxProtocol(packageRoot: string, specifier: string, owner: StorybookPackageOwner | null): boolean
  }>
}
