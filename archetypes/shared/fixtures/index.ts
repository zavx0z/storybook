/**
Подготавливает выбор входного пути для спецификаций Archetypes.

@packageDocumentation
*/
import {dirname, isAbsolute, resolve} from "node:path"
import {fileURLToPath} from "node:url"

/**
Создаёт функцию выбора внешнего пути либо локальной фикстуры сценария.

@param inputPath - Явно переданный внешний путь; undefined включает локальные фикстуры.
@returns Функция, принимающая относительный fixturePath и возвращающая выбранный путь.
Локальная директория fixture находится рядом с ближайшим файлом .spec.ts или
.spec.tsx в стеке вызова. Вызывать при инициализации спецификации.
Переменные окружения здесь не читаются; внешний путь не требует поиска в стеке.
@throws Если при отсутствии внешнего пути файл спецификации не найден в стеке.
*/
export function createFixture(
  inputPath: string | undefined,
): (fixturePath: string) => string {
  if (inputPath !== undefined) return () => inputPath

  for (const line of new Error().stack?.split("\n").slice(1) ?? []) {
    const match = line.match(/(?:\(|at )((?:file:\/\/)?[^()]+\.spec\.tsx?):\d+:\d+\)?$/)
    if (!match?.[1]) continue
    const path = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1]
    if (!isAbsolute(path)) continue
    const root = resolve(dirname(path), "fixture")
    return (fixturePath: string) => resolve(root, fixturePath)
  }
  throw new Error("Не удалось определить файл спецификации для директории fixture")
}
