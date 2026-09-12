/**
Подготавливает данные для проверки скриптов пакета по переданному пути.
Файлы сценариев разбираются через AST,
без исполнения. Поддерживается текущая форма describe.each с именем $name
и команд bun test ./spec с фильтром --test-name-pattern.

@packageDocumentation
*/
import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {API} from "typescript/unstable/async"
import type {Node} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast/is"

const root = fileURLToPath(new URL("../../../../", import.meta.url))

/** Читает имена вариантов текущего формата; вычисления props и runtime не выполняются. */
async function readScenarioNames(path: string): Promise<string[]> {
  const api = new API({cwd: root})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    const project = await snapshot.getDefaultProjectForFile(path)
    const source = await project?.program.getSourceFile(path)
    if (source === undefined) throw new Error(`Не найден файл сценариев: ${path}`)
    const names: string[] = []
    const visit = (node: Node) => {
      if (isCallExpression(node) && isCallExpression(node.expression)) {
        const access = node.expression.expression
        if (isPropertyAccessExpression(access) && access.name.text === "each"
          && isIdentifier(access.expression) && access.expression.text === "describe") {
          const table = node.expression.arguments[0]
          const title = node.arguments[0]
          if (!table || !isArrayLiteralExpression(table) || !title || !isStringLiteral(title) || title.text !== "$name") {
            throw new Error("Ожидается describe.each с явной таблицей и названием $name")
          }
          for (const row of table.elements) {
            if (!isObjectLiteralExpression(row)) throw new Error("Ожидается объект параметров сценария")
            const field = row.properties.find(property => isPropertyAssignment(property)
              && (isIdentifier(property.name) || isStringLiteral(property.name)) && property.name.text === "name")
            if (!field || !isPropertyAssignment(field) || !isStringLiteral(field.initializer)) {
              throw new Error("Сценарий должен иметь явное строковое имя")
            }
            names.push(field.initializer.text)
          }
        }
      }
      node.forEachChild(visit)
    }
    visit(source)
    return names
  } finally {
    await api.close()
  }
}

/**
Подготавливает данные выбранного пакета без чтения переменных окружения.

@param inputPath - Путь к проверяемому пакету, явно выбранный вызывающей спецификацией.

@returns Наличие сценариев, непокрытые варианты и имена скриптов их запуска.

@throws Ошибки чтения файлов и разбора сценариев или фильтров скриптов.
*/
export async function createScriptFixture(inputPath: string) {
  const paths = ["scenario.spec.ts", "scenario.spec.tsx"].map(name => resolve(inputPath, "spec", name))
  const names: string[] = []
  for (const path of paths) {
    if (await Bun.file(path).exists()) names.push(...await readScenarioNames(path))
  }
  const hasScenarios = names.length > 0
  const manifest = JSON.parse(await readFile(resolve(inputPath, "package.json"), "utf8"))
  const scripts: {name: string, pattern: RegExp}[] = []
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (!name.startsWith("test:") || typeof command !== "string") continue
    const match = /^bun test \.\/spec --test-name-pattern (['"])(.*?)\1$/u.exec(command)
    if (match) scripts.push({name, pattern: new RegExp(match[2]!)})
  }

  const covered = new Set<string>()
  for (const {pattern} of scripts) {
    const selected = names.filter(name => pattern.test(name))
    if (selected.length === 1) covered.add(selected[0]!)
  }

  return {
    path: inputPath,
    hasScenarios,
    missingScripts: names.filter(name => !covered.has(name)),
    scriptNames: scripts.map(script => script.name),
  }
}
