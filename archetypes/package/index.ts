/**
Каркас чтения структуры пакета по явно переданному пути.
Чтение файлов и проверка структуры пока не реализованы.

@packageDocumentation
*/
import type {ReadPackageInput} from "./contract/input.ts"

export type {ReadPackageInput}

/** Заготовка чтения структуры пакета по входному контракту. */
export function readPackage({path}: ReadPackageInput): void {}
