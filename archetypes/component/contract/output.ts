import type {ReadPackageOutput} from "@archetypes/package"

/**
Наблюдаемая форма компонента без его запуска.

@property package - Общий состав пакета.
@property entries - Собственные кодовые ветви основного экспорта с именами runtime exports.
Имена определяются штатным синтаксическим сканером Bun, не по расширению директории.
@property additionalCode - Дополнительные самостоятельные кодовые подпути или чужие реализации.
@property scenarios - Непосредственные сценарии использования компонента.
*/
export interface ReadComponentOutput {
  readonly package: ReadPackageOutput
  readonly entries: readonly {readonly path: string, readonly exports: readonly string[], readonly input: string | null, readonly output: string | null, readonly jsx: boolean}[]
  readonly additionalCode: readonly string[]
  readonly scenarios: readonly string[]
}
