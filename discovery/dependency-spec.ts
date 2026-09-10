/**
Извлекает ожидаемый граф из структурного spec без запуска тестов и импортов.
Наличие файла задаёт возможность просмотра; успешность теста здесь не утверждается.

@packageDocumentation
*/
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"
import type {StorybookDependencyCase, StorybookDependencySpec} from "../catalog/catalog.t.ts"
import {readParameterizedTests, type TestParameter} from "./read-parameterized-tests.ts"

function object(value: TestParameter | undefined): value is {[key: string]: TestParameter} {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export async function readDependencySpec(root: string, path: string): Promise<StorybookDependencySpec> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let source: string
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 1_048_576) throw new Error(`Слишком большой или недопустимый deps.spec.ts: ${path}`)
    source = await file.readFile("utf8")
  } finally { await file.close() }
  const tests = await readParameterizedTests(root, path)
  const cases: StorybookDependencyCase[] = []
  for (const test of tests) {
    for (const value of test.parameters) {
      if (!object(value) || typeof value.name !== "string" || typeof value.file !== "string" || !object(value.expected)) {
        throw new Error(`deps.spec.ts ожидает параметры {name, file, expected}: ${path}`)
      }
      const entries = Object.entries(value.expected).map(([id, entry]) => {
        if (!id.includes("#") || !object(entry) || !Array.isArray(entry.uses) || !Array.isArray(entry.elements)
          || !entry.uses.every(item => typeof item === "string") || !entry.elements.every(item => typeof item === "string")) {
          throw new Error(`Неверный узел графа зависимостей: ${id}`)
        }
        return [id, {uses: entry.uses as string[], elements: entry.elements as string[]}] as const
      })
      const graph = Object.fromEntries(entries)
      if (entries.length === 0 || !Object.hasOwn(graph, `${value.file}#${value.name}`)) {
        throw new Error(`В графе отсутствует корневой компонент: ${value.file}#${value.name}`)
      }
      for (const [id, entry] of entries) {
        for (const dependency of entry.uses) {
          if (!Object.hasOwn(graph, dependency)) throw new Error(`Неизвестная зависимость ${id} → ${dependency}`)
        }
      }
      cases.push({name: value.name, file: value.file, testName: test.name, graph})
    }
  }
  if (cases.length === 0) throw new Error(`В deps.spec.ts отсутствуют варианты test.each: ${path}`)
  if (await Bun.file(path).text() !== source) throw new Error(`deps.spec.ts изменился во время чтения: ${path}`)
  return {sourcePath: path, sourceDigest: createHash("sha256").update(source).digest("hex"), cases}
}
