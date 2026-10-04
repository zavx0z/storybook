import type {StorybookComponent} from "@storybook/component"

export declare namespace StorybookContainer {
  /** Тот же путь к физическому владельцу; признак Container не передаётся вызывающим кодом. */
  export type Input = StorybookComponent.Input

  /**
  Собственная публичная реализация и состав композиции без исполнения кода.

  @property component - Публичный вход, контракты и сценарии целого, прочитанные
  тем же механизмом, что у Component. Наличие результата не подтверждает класс.

  @property parts - Непосредственные вложенные пакеты и обращения к ним из кода
  целого. Потомки вложенного Container остаются у него; внешние зависимости
  не становятся принадлежащими частями. references содержит только runtime
  импорты из исходников самого целого, а не косвенные ссылки, реэкспорты или
  типовые связи. Участие через другую достигнутую часть проверяет сценарий
  Package. Импорт ещё не доказывает вызов.
  */
  export interface Output {
    readonly component: StorybookComponent.Output
    readonly parts: readonly {
      readonly name: string
      readonly path: string
      readonly references: StorybookComponent.Output["package"]["code"][number]["references"]
    }[]
  }
}
