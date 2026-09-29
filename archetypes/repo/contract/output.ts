import type {ReadPackageOutput} from "@archetypes/package"

/**
Факты о пакете и его границе версионирования.

@property package - Состав пакета по общему читателю.
@property root - Каноническая директория проверяемого пакета.
@property gitRoot - Корень Git либо null, если пакет не находится в рабочем дереве.
@property nestedRepositories - Gitlinks и самостоятельные Git-корни обнаруженных вложенных пакетов.
*/
export interface ReadRepoOutput {
  readonly package: ReadPackageOutput
  readonly root: string
  readonly gitRoot: string | null
  readonly nestedRepositories: readonly string[]
}
