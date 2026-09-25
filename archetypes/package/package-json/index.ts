/**
Извлекает из package.json имя, необязательное название, описание и публичные экспорты.

@packageDocumentation
*/
import type {ReadPackageJsonInput} from "./contract/input"
import type {ReadPackageJsonOutput} from "./contract/output"

export type {ReadPackageJsonInput, ReadPackageJsonOutput}

/**
Читает указанный файл через Bun и возвращает только поля выходного контракта.
Содержимое карты exports сохраняется без преобразования.

@param path - Путь к файлу; относительный путь разрешается от текущей рабочей директории.

@returns Имя, возможное отображаемое название, описание и карта публичных экспортов пакета.

@throws Ошибка чтения файла или разбора JSON.
@throws TypeError, если манифест не является объектом, отсутствует обязательное
поле либо имя и описание не являются строками, заданное название не строка,
а exports — объектом.
*/
export async function readPackageJson({path}: ReadPackageJsonInput): Promise<ReadPackageJsonOutput> {
  const manifest: unknown = await Bun.file(path).json()
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("package.json должен содержать объект")
  }
  if (!("name" in manifest) || typeof manifest.name !== "string"
    || ("label" in manifest && typeof manifest.label !== "string")
    || !("description" in manifest) || typeof manifest.description !== "string"
    || !("exports" in manifest) || manifest.exports === null
    || typeof manifest.exports !== "object" || Array.isArray(manifest.exports)) {
    throw new TypeError("package.json должен содержать строки name, description, необязательную строку label и объект exports")
  }
  return {
    name: manifest.name,
    ...("label" in manifest ? {label: manifest.label as string} : {}),
    description: manifest.description,
    exports: manifest.exports as Readonly<Record<string, unknown>>,
  }
}
