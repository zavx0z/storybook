import type {Declaration, Diagnostic, Extension, Namespace} from "./declaration"

/** Типовая сторона публичного читателя контракта. */
export declare namespace ArchetypesContracts {
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
  @property extensions - Исходные связи общего протокола и протоколов участников с результатом типовой совместимости каждой общей роли.
  @property sources - Прочитанные исходники и их SHA-256 для проверки одного согласованного чтения.
  */
  interface Output {
    readonly root: string
    readonly name: string
    readonly entries: readonly {
      readonly path: string
      readonly exportPath: string
      readonly conditions: readonly string[]
      /** Исходное объявление основной runtime-реализации, независимо от места реэкспорта. */
      readonly implementation: Declaration | null
      readonly exports: readonly {readonly name: string, readonly runtime: boolean}[]
      readonly namespaces: readonly Namespace[]
    }[]
    readonly diagnostics: readonly Diagnostic[]
    readonly extensions: readonly Extension[]
    readonly sources: readonly {readonly path: string, readonly digest: string}[]
  }
}
