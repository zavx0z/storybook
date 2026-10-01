import type {PackageManifest, RoutePosition} from "./types"

/** Контракт физического прохода workspace и публичных директорий. */
export declare namespace RouteStructure {
  /**
  Операции одного уровня прохода с чтением package.json и проверкой ownership.

  @property readPackageManifest - Читает identity и объявленные workspace paths
  точного пакета; неверный либо отсутствующий manifest даёт null.

  @property readRootPath - Канонизирует только обычную физическую директорию.

  @property enterWorkspace - Продолжает проход внутри workspace prefix или
  входит в объявленный вложенный пакет; несоответствие даёт null.

  @property readAvailableViews - Возвращает проверенные файловые сценарии,
  контракт и зависимости непосредственного владельца.

  @property readWorkspaceChildNames - Возвращает имена непосредственных
  workspace-ветвей в авторском порядке.
  */
  type Output = Readonly<{
    readPackageManifest(packagePath: string): Promise<PackageManifest | null>
    readRootPath(path: string): Promise<string | null>
    enterWorkspace(rootPath: string, position: RoutePosition, manifest: PackageManifest, segment: string): Promise<RoutePosition | null>
    readAvailableViews(rootPath: string, ownerPath: string, scenarioOwner: boolean, moduleOwner: boolean, repository: string | null): Promise<readonly ("scenarios" | "contract" | "dependencies")[]>
    readWorkspaceChildNames(position: RoutePosition, manifest: PackageManifest): readonly string[]
  }>
}
