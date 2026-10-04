import type {StorybookPackageReader} from "@zavx0z/storybook-package-reader"

export declare namespace StorybookRepoReader {
  /**
  Директория проверяемого пакета; класс не передаётся вызывающим кодом.

  @property path - Физический корень пакета.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Факты о пакете и его границе версионирования.

  @property package - Состав пакета по общему читателю.
  @property root - Каноническая директория проверяемого пакета.
  @property gitRoot - Корень Git либо null, если пакет не находится в рабочем дереве.
  @property nestedRepositories - Gitlinks и самостоятельные Git-корни обнаруженных вложенных пакетов.
  */
  export interface Output {
    readonly package: StorybookPackageReader.Output
    readonly root: string
    readonly gitRoot: string | null
    readonly nestedRepositories: readonly string[]
  }
}
