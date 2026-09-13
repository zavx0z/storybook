/**
Читает данные пакета из непосредственно принадлежащего ему package.json.

@packageDocumentation
*/
import {resolve} from "node:path"
import {readPackageJson} from "@archetypes/package/package-json"
import type {ReadPackageInput} from "./contract/input"
import type {ReadPackageOutput} from "./contract/output"

export type {ReadPackageInput, ReadPackageOutput}

/**
Передаёт чтение непосредственного package.json сущности, владеющей его контрактом.

@param path - Директория пакета; относительный путь разрешается от cwd.

@returns Объект состава пакета с данными package.json в поле packageJson.
@throws Ошибки чтения, разбора и проверки package.json.
*/
export async function readPackage({path}: ReadPackageInput): Promise<ReadPackageOutput> {
  return {
    packageJson: await readPackageJson({path: resolve(path, "package.json")}),
  }
}
