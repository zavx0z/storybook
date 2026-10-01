import type {ReadComponentOutput} from "@archetypes/component"

/**
Собственная публичная реализация и состав композиции без исполнения кода.

@property component - Публичный вход, контракты и сценарии целого, прочитанные
тем же механизмом, что у Component. Наличие результата не подтверждает класс.

@property parts - Непосредственные вложенные пакеты и обращения к ним из кода
целого. Потомки вложенного Container остаются у него; внешние зависимости
не становятся принадлежащими частями. references содержит только runtime
импорты, а не реэкспорты или типовые связи. Импорт ещё не доказывает вызов.
*/
export interface ReadContainerOutput {
  readonly component: ReadComponentOutput
  readonly parts: readonly {
    readonly name: string
    readonly path: string
    readonly references: ReadComponentOutput["package"]["code"][number]["references"]
  }[]
}
