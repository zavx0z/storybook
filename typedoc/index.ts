/**
TypeDoc раскрывает документацию объявлений и правила её авторства.
TypeScript связывает doc-блоки с функциями, методами, типами и namespace;
сценарий сопоставляет теги с сигнатурами и проверяет оформление.
Смысловая достаточность, правдивость побочных эффектов и полезность примеров
остаются отдельными явно незавершёнными проверками сценария.
Другие владельцы вызывают этот сценарий для своих исходников.
Чтение не исполняет исследуемый код и не создаёт визуальное представление документации.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {resolve} from "node:path"
import {API} from "typescript/unstable/async"
import {readSource} from "./src/read"
import type {Zavx0zStorybookTypedoc} from "./contract"

export type {Zavx0zStorybookTypedoc} from "./contract"

/**
Читает собственные объявления выбранных файлов через одну сессию TypeScript.

@param input - Пути к исходникам согласно {@link Zavx0zStorybookTypedoc.Input}.

@returns Документация, исходные сигнатуры и digest каждого файла.
Пустые описания сохраняются для проверки в сценарии; reader не объявляет их соответствующими правилам.

@throws TypeError при пустом списке путей; ошибки чтения, синтаксиса TypeScript или изменения исходника.
Модульный читатель отклоняет исходник больше 1 МиБ с RangeError.
Сессия компилятора освобождается также при ошибке; код исследуемых модулей не запускается.

@example
```ts
const result = await readTypeDoc({paths: ["app/web/release/contract/index.ts"]})
```
*/
export default async function readTypeDoc(input: Zavx0zStorybookTypedoc.Input): Promise<Zavx0zStorybookTypedoc.Output> {
  if (input.paths.length === 0) throw new TypeError("Укажите хотя бы один исходник TypeDoc")
  const paths = [...new Set(await Promise.all(input.paths.map(path => realpath(resolve(path)))))]
  const api = new API({cwd: process.cwd()})
  try {
    const snapshot = await api.updateSnapshot({openFiles: paths})
    const sources = []
    for (const path of paths) {
      const project = await snapshot.getDefaultProjectForFile(path)
      if (!project) throw new Error(`TypeScript не определил проект исходника: ${path}`)
      sources.push(await readSource(path, project))
    }
    return {sources}
  } finally {
    await api.close()
  }
}
