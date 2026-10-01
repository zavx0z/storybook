import type {Diagnostic, Namespace} from "./declaration"

/** Типовая сторона публичного читателя контракта. */
export declare namespace Contract {
  /**
  Выбор владельца публичного контракта.

  @property path - Физический корень пакета с package.json; относительный путь разрешается от cwd.
  */
  interface Input {
    readonly path: string
  }

  /**
  Сведения о типовой границе пакета, полученные без выполнения исследуемых модулей.

  @property entries - Публичные кодовые входы и namespace с исходными владельцами.
  @property diagnostics - Нарушения структуры контракта; пустой массив не доказывает корректность runtime.
  @property sources - Прочитанные исходники и их SHA-256 для проверки одного согласованного чтения.
  */
  interface Output {
    readonly root: string
    readonly name: string
    readonly entries: readonly {
      readonly path: string
      readonly exports: readonly {readonly name: string, readonly runtime: boolean}[]
      readonly namespaces: readonly Namespace[]
    }[]
    readonly diagnostics: readonly Diagnostic[]
    readonly sources: readonly {readonly path: string, readonly digest: string}[]
  }
}
