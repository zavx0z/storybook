/**
Удаляет пробелы по краям текста, сохраняя его содержимое.

@packageDocumentation
*/
import type {TrimInput} from "./contract/input"
import type {TrimOutput} from "./contract/output"

/** Возвращает очищенный текст; исходная строка остаётся у вызывающего кода. */
export function trimText(input: TrimInput): TrimOutput {
  return input.trim()
}
