/**
Форматирует пробельную форму JSON для чтения служебных документов.
JSON.parse проверяет валидность; форматирование сохраняет исходные лексемы,
включая большие числа и повторные ключи. Документ не обрезается, не исполняется
и не преобразуется в новый объект для обратной сериализации.

@packageDocumentation
*/
import type {StorybookTechJsonFormat as Contract} from "./contract"
import {formatWhitespace, escapedLineBreaks} from "./src/format"

export type {StorybookTechJsonFormat} from "./contract"

/**
@param input - Полный исходный JSON или обычный текст.
@returns Документ с отступами и визуальными переносами; невалидный JSON сохраняется как plaintext.
@throws TypeError Если input не является строкой.
*/
export default function formatJson(input: Contract.Input): Contract.Output {
  if (typeof input !== "string") throw new TypeError("JSON source must be a string")
  try { JSON.parse(input) } catch {
    return {text: input, softBreaks: [], languageId: "plaintext"}
  }
  const text = formatWhitespace(input)
  return {text, softBreaks: escapedLineBreaks(text), languageId: "json"}
}
