/**
Извлекает из package.json идентичность, описание, публичные экспорты,
состав workspaces и стандартные карты зависимостей.

@packageDocumentation
*/
import type {ReadPackageJsonInput} from "./contract/input"
import type {ReadPackageJsonOutput} from "./contract/output"

export type {ReadPackageJsonInput, ReadPackageJsonOutput}

/**
Читает указанный файл через Bun и возвращает только поля выходного контракта.
Значения карты exports сохраняются; строковая форма становится входом `.`.
Отсутствующие description и exports остаются пустыми, чтобы нормативный сценарий
мог сообщить о применимых требованиях, не прерывая чтение Repo или Domain.

@param path - Путь к файлу; относительный путь разрешается от текущей рабочей директории.

@returns Имя, возможное отображаемое название, описание и карта публичных экспортов пакета.

@throws Ошибка чтения файла или разбора JSON.
@throws TypeError, если манифест не является объектом, имя отсутствует,
description/label имеют неверный тип либо exports/workspaces и карты зависимостей имеют недопустимую форму.
*/
export default async function readPackageJson({path}: ReadPackageJsonInput): Promise<ReadPackageJsonOutput> {
  const manifest: unknown = await Bun.file(path).json()
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("package.json должен содержать объект")
  }
  if (!("name" in manifest) || typeof manifest.name !== "string"
    || ("label" in manifest && typeof manifest.label !== "string")
    || ("description" in manifest && typeof manifest.description !== "string")
    || ("exports" in manifest && manifest.exports !== null && typeof manifest.exports !== "string" && typeof manifest.exports !== "object")) {
    throw new TypeError("package.json должен содержать имя и допустимые npm metadata")
  }
  const workspaces = "workspaces" in manifest ? manifest.workspaces : undefined
  const patterns = Array.isArray(workspaces) ? workspaces
    : workspaces && typeof workspaces === "object" && "packages" in workspaces ? workspaces.packages : undefined
  if (workspaces !== undefined && (!Array.isArray(patterns) || !patterns.every(value => typeof value === "string"))) {
    throw new TypeError("workspaces задаёт массив путей либо объект с массивом packages")
  }
  const dependencies: Partial<Pick<ReadPackageJsonOutput, "dependencies" | "peerDependencies" | "optionalDependencies" | "devDependencies">> = {}
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"] as const) {
    if (!(key in manifest)) continue
    const value = Reflect.get(manifest, key)
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string")) {
      throw new TypeError(`${key} задаёт имена пакетов и строковые версии`)
    }
    Object.assign(dependencies, {[key]: value})
  }
  const declared = "exports" in manifest ? manifest.exports : undefined
  const exports = declared === undefined ? {}
    : typeof declared === "string" || declared === null || Array.isArray(declared) ? {".": declared}
    : declared as Readonly<Record<string, unknown>>
  return {
    name: manifest.name,
    ...dependencies,
    ...("label" in manifest ? {label: manifest.label as string} : {}),
    description: "description" in manifest ? manifest.description as string : "",
    exports,
    ...(workspaces === undefined ? {} : {workspaces: workspaces as NonNullable<ReadPackageJsonOutput["workspaces"]>}),
  }
}
