/**
Component владеет конкретной возможностью, публичным контрактом и своей реализацией.
Единственная основная реализация экспортируется через default; типы — именованно.
Функция, класс, таблица и символ допустимы по своему смыслу без фиктивного callable.
Он может использовать и содержать другие компоненты, оставаясь Component.
Состояние, подписки, визуальность и среда исполнения не являются обязательными.
Самостоятельные внутренние предметы получают пакеты; частные помощники остаются в src.

@packageDocumentation
*/
import {resolve} from "node:path"
import readPackage from "@archetypes/package"
import type {ReadComponentInput} from "./contract/input"
import type {ReadComponentOutput} from "./contract/output"

export type {ReadComponentInput, ReadComponentOutput}

/** Сканирует публичные входы без исполнения и без генерации bundle. */
export default async function readComponent({path}: ReadComponentInput): Promise<ReadComponentOutput> {
  const description = await readPackage({path})
  const entries: ReadComponentOutput["entries"][number][] = []
  for (const entry of description.index.entries) {
    if (entry.path !== "." || entry.status !== "owned" || !entry.code || !entry.target) continue
    const source = resolve(description.root, entry.target)
    const jsx = /\.[jt]sx$/u.test(source)
    entries.push({path: source, exports: description.code.find(item => item.path === source)?.exports.filter(item => item.runtime).map(item => item.name) ?? [],
      input: entry.input, output: entry.output, jsx})
  }
  return {package: description, entries, scenarios: description.scenarios,
    additionalCode: description.index.entries.filter(entry => entry.code && entry.status !== "blocked" && (entry.path !== "." || entry.status !== "owned")).map(entry => entry.path)}
}
