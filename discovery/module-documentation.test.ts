import {expect, test} from "bun:test"
import {readModuleDocumentation} from "./module-documentation.ts"

test("извлекает только документацию модуля, сохраняя Markdown и примеры", () => {
  const source = '/** Лицензия */\n/**\n * # Модуль\n *\n * Описание `API`.\n * @remarks\n * Подробности.\n * @example\n * ```ts\n * const value = "@packageDocumentation"\n * ```\n * @packageDocumentation\n */\nthrow new Error("Не исполнять")\n/** Документация класса */\nexport class Sample {}'
  const doc = readModuleDocumentation(source, "/owner/index.ts")!
  expect(doc.markdown).toContain("# Модуль")
  expect(doc.markdown).toContain('const value = "@packageDocumentation"')
  expect(doc.markdown).toContain("### Пример")
  expect(doc.markdown).not.toContain("Не исполнять")
  expect(doc.markdown).not.toContain("Лицензия")
  expect(doc.sourcePath).toBe("/owner/index.ts")
  expect(doc.sourceDigest).toMatch(/^[a-f0-9]{64}$/u)
})

test("не подменяет документацию модуля комментариями сущностей или строками", () => {
  for (const source of [
    '/** Описание класса */\nexport class Sample {}',
    'export const text = "/** @packageDocumentation */"',
    'import "./side-effects"\n/**\nНе обзор\n@packageDocumentation\n*/',
    '/**\n```ts\n@packageDocumentation\n```\n*/',
  ]) expect(readModuleDocumentation(source, "index.ts")).toBeNull()
  expect(() => readModuleDocumentation('/** One\n@packageDocumentation\n*/\n/** Two\n@packageDocumentation\n*/', "index.ts")).toThrow("Multiple")
})
