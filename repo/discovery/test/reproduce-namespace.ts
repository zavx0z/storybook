/**
Воспроизводит отсутствие rich TypeDoc для `contract/index.ts` с ambient namespace.

Ожидается: публичный parser вернёт документы ролей Input, Output и Slots,
вложенные поля Input.options и JSON Schema для Input. Сейчас он отклоняет файл
с `TypeDoc: нет экспортируемого type/interface`, поскольку роли вложены в namespace.

Запуск: `bun repo/discovery/test/reproduce-namespace.ts` из корня Storybook.
*/
import {resolve} from "node:path"
import {analyzeTypeDoc} from "@immersive/typedoc/parser"

const root = resolve(import.meta.dir, "../../..")
const path = resolve(import.meta.dir, "fixture/namespace-contract/contract/index.ts")
const {document} = await analyzeTypeDoc({root, path})
const role = (name: string) => document.declarations.find(declaration =>
  declaration.name === name || declaration.name.endsWith(`.${name}`))
const missing = ["Input", "Output", "Slots"].filter(name => role(name) === undefined)
if (missing.length) throw new Error(`TypeDoc не раскрыл роли namespace: ${missing.join(", ")}`)

const input = role("Input")!
const options = input.members.find(member => member.name === "options")
if (!options?.children?.some(member => member.name === "limit")) {
  throw new Error("TypeDoc не раскрыл вложенное поле Input.options.limit")
}
if (input.schema?.properties?.options?.properties?.limit?.type !== "number") {
  throw new Error("TypeDoc не построил JSON Schema для Input.options.limit")
}
