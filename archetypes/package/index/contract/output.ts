/**
Фактический состав публичных входов без исполнения кода и оценки его смысла.

@property entries - Точные строковые цели exports и их условия. path — публичный
подпуть, target — исходная цель, conditions — путь условий без выбора среды.
status различает принадлежащий пакету файл, публичный вход вложенного пакета,
отсутствие, закрытый исходник вложенного пакета,
выход за пакет, символическую ссылку и закрытый через null экспорт.
code обозначает JS/TS-исходник, entrypoint — index.ts или index.tsx.
input и output содержат относительные пути обычных файлов контрактов входа
или null; они читаются только у принадлежащего пакету entrypoint.

@property unchecked - Объявления, которые не были проверены: шаблонные пути,
fallback-массивы или неизвестные формы. Они не означают нарушение стандарта.
*/
export interface ReadPackageIndexOutput {
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
