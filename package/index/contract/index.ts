export declare namespace ArchetypesPackageIndex {
  /**
  Выбор пакета и его объявленных публичных входов.

  @property path - Директория пакета, относительно которой разрешаются цели exports.

  @property exports - Неизменённая карта публичных путей из package.json.
  */
  export interface Input {
    readonly path: string
    readonly exports: Readonly<Record<string, unknown>>
  }

  /**
  Фактический состав публичных входов без исполнения кода и оценки его смысла.

  @property entries - Точные строковые цели exports и их условия. path — публичный
  подпуть, target — исходная цель, conditions — путь условий без выбора среды.
  status различает принадлежащий пакету файл, публичный вход вложенного пакета,
  отсутствие, закрытый исходник вложенного пакета,
  выход за пакет, символическую ссылку и закрытый через null экспорт.
  code обозначает JS/TS-исходник, entrypoint — существующий публичный кодовый вход.
  input и output содержат относительные пути файла контракта либо null;
  `contract/<имя входа>.ts` может быть целью обеих ролей. Это файловая подсказка,
  а не доказательство объявления роли: фактический namespace раскрывает Contracts.

  @property unchecked - Объявления, которые не были проверены: шаблонные пути,
  fallback-массивы или неизвестные формы. Они не означают нарушение стандарта.
  */
  export interface Output {
    readonly entries: readonly {
      readonly path: string
      readonly target: string | null
      readonly conditions: readonly string[]
      readonly status: "owned" | "forwarded" | "missing" | "nested-package" | "outside-package" | "symlink" | "blocked"
      readonly code: boolean
      readonly entrypoint: boolean
      readonly input: string | null
      readonly output: string | null
      /** Точный владелец реализации при прямом публичном экспорте вложенного пакета. */
      readonly owner?: {readonly path: string, readonly name: string, readonly export: string}
    }[]
    readonly unchecked: readonly {readonly path: string, readonly conditions: readonly string[], readonly reason: string}[]
  }
}
