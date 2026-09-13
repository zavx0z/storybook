import type {ReadPackageJsonOutput} from "@archetypes/package/package-json"

/**
Прочитанный состав пакета.

@property packageJson - Результат чтения непосредственно принадлежащего пакету package.json.
*/
export interface ReadPackageOutput {
  readonly packageJson: ReadPackageJsonOutput
}
