import type {StorybookCatalogScope} from "./catalog"

/** Контракт обнаружения физических пакетов и их проверенной структуры. */
export declare namespace Zavx0zStorybookRepoDiscovery {
  /** Выбранные корни, прежний каталог и необязательные границы повторного анализа. */
  type Input = readonly [
    roots: readonly string[],
    previous?: Output,
    options?: Readonly<{
      dirtyScopeRoots?: readonly string[]
      onAnalysisSession?: (kind: "contract" | "dependency") => void
    }>,
  ]

  /** Сырой нормализованный каталог обнаружения без графа и состояния реестра. */
  type Output = Readonly<{
    schemaVersion: 1
    rootIds: readonly string[]
    scopes: readonly StorybookCatalogScope[]
  }>
}
