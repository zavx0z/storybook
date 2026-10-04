/**
Раскрывает Project агенту через собственное имя и переходы к участвующим Repo.
Использует подготовленный каталог проекта; чтение файлов, обнаружение состава
и подключение агентской сессии остаются у вызывающих владельцев.
Project сам отбирает Repo первого уровня и формирует их краткие описания и подписи.

@packageDocumentation
*/
import type {StorybookProjectMcp} from "./contract"

export type {StorybookProjectMcp} from "./contract"

/**
Формирует корневой ответ Project без исполнения кода его Repo или изменения каталога.

@param input - Собственное имя Project и публичные направления его текущего каталога.

@returns Имя проекта, объяснение переходов и Repo первого уровня.
Имя проекта не добавляется к адресам Repo; пустой состав сохраняет идентичность Project.

@throws TypeError, если имя Project пустое или состоит только из пробельных символов.

@example
```ts
const project = readProjectMcp({
  projectName: "Мастерская",
  entries: [{path: "shop", description: "Продажа товаров.", parent: null}],
})
```
*/
export default function readProjectMcp(input: StorybookProjectMcp.Input): StorybookProjectMcp.Output {
  const {projectName, entries} = input
  if (typeof projectName !== "string" || projectName.trim().length === 0) {
    throw new TypeError("Project name must be non-empty text")
  }
  return {
    description: "Выберите Repo текущего Project по описанию. Для перехода передайте path выбранного элемента children в следующий вызов storybook. Выбранный владелец раскрывает input и output как JSON Schema с описаниями. Пустой вызов возвращает к этому входу.",
    label: projectName,
    children: entries.filter(entry => entry.parent === null).map(entry => {
      const authored = entry.summary ?? entry.description
      const description = authored.trim().length > 0
        ? authored.split(/\n\s*\n/u)[0]!
        : "Описание не задано владельцем."
      const label = entry.label?.trim().toLocaleLowerCase("ru")
      const text = description.trimStart().toLocaleLowerCase("ru")
      const next = label === undefined ? undefined : text.slice(label.length).match(/^./u)?.[0]
      const repeated = label !== undefined && (
        entry.path.split("/").at(-1)?.toLocaleLowerCase("ru") === label
        || text.startsWith(label) && (next === undefined || !/[\p{L}\p{N}_]/u.test(next))
      )
      return {
        description,
        path: entry.path,
        ...(label && !repeated ? {label: entry.label!} : {}),
      }
    }),
  }
}
