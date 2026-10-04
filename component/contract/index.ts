import type {StorybookPackageReader} from "@zavx0z/storybook-package-reader"

export declare namespace StorybookComponent {
  /**
  Директория проверяемого пакета; класс не передаётся вызывающим кодом.

  @property path - Физический корень пакета.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Наблюдаемая форма компонента без его запуска.

  @property package - Общий состав пакета.
  @property entries - Собственные кодовые ветви основного экспорта с именами runtime exports.
  Runtime-имена выбираются из native символов TypeScript; type-only контракты не считаются реализациями.
  @property additionalCode - Дополнительные самостоятельные кодовые подпути или чужие реализации.
  @property scenarios - Непосредственные сценарии использования компонента.
  */
  export interface Output {
    readonly package: StorybookPackageReader.Output
    readonly entries: readonly {readonly path: string, readonly exports: readonly string[], readonly input: string | null, readonly output: string | null, readonly jsx: boolean}[]
    readonly additionalCode: readonly string[]
    readonly scenarios: readonly string[]
  }
}
