/**
Исследует объявленные публичные входы пакета без исполнения исходников.
Условные экспорты сохраняют свои ветви; выбор среды исполнения не производится.

@packageDocumentation
*/
import {resolve} from "node:path"
import {collectTargets} from "./src/targets"
import {readTarget} from "./src/target"
import type {Zavx0zStorybookPackageIndex} from "./contract"

export type {Zavx0zStorybookPackageIndex} from "./contract"

/**
Читает наличие и принадлежность точных файлов из exports.

@param path - Директория проверяемого пакета.
@param exports - Карта публичных путей из непосредственного package.json.
@returns Объявленные ветви с данными файлов и отдельно неподдержанные объявления.
Шаблоны и fallback-массивы сохраняются как непроверенные, не как отсутствующие файлы.
@throws Ошибки доступа к файлам, кроме отсутствия пути.
*/
export default async function readPackageIndex({path, exports}: Zavx0zStorybookPackageIndex.Input): Promise<Zavx0zStorybookPackageIndex.Output> {
  const declared = collectTargets(exports)
  const entries = await Promise.all(declared.targets.map(target => readTarget(resolve(path), target)))
  return {entries, unchecked: declared.unchecked}
}
