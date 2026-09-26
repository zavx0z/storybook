/**
Возвращает результат чтения спецификации через публичный readSpec.

@packageDocumentation
*/
import {readSpec} from "@storybook/app/spec-reader"

/**
Передаёт чтение спецификации её владельцу Specs.

@param path - Путь к владельцу спецификации.
@returns Фактический результат readSpec в поле result.
@throws Ошибки чтения и запуска спецификации из readSpec.
*/
export async function readPackageNode(path: string) {
  return {result: await readSpec({path})}
}
