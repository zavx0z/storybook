import {afterAll, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, renameSync, rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import access from "@zavx0z/storybook-package-resources-access"

const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, {recursive: true, force: true}) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "package-resource-"))
  roots.push(root)
  const host = join(root, "host")
  const owner = join(root, "independent-location")
  mkdirSync(join(host, "node_modules/@fixture"), {recursive: true})
  mkdirSync(join(owner, "src"), {recursive: true})
  writeFileSync(join(owner, "package.json"), JSON.stringify({name: "@fixture/resources", type: "module", files: ["src"], exports: {".": "./index.ts"}}))
  writeFileSync(join(owner, "src/document.md"), "# Настоящий файл\n")
  writeFileSync(join(owner, "private.md"), "Не опубликован")
  writeFileSync(join(owner, "index.ts"), 'throw new Error("Чтение не запускает модуль")\n')
  symlinkSync(owner, join(host, "node_modules/@fixture/resources"))
  return {root, host, owner}
}
const document = {package: "@fixture/resources", path: "src/document.md"}
test("пакет находится по dependency при произвольном размещении и переносе", () => {
  const f = fixture()
  expect(access({directory: f.host}).read(document)).toBe("# Настоящий файл\n")
  const moved = join(f.root, "relocated")
  renameSync(f.owner, moved)
  rmSync(join(f.host, "node_modules/@fixture/resources"))
  symlinkSync(moved, join(f.host, "node_modules/@fixture/resources"))
  expect(access({directory: f.host}).read(document)).toBe("# Настоящий файл\n")
  expect(document).toEqual({package: "@fixture/resources", path: "src/document.md"})
})
test("files определяет доступные данные, exports — модули без исполнения при чтении", () => {
  const f = fixture()
  const reader = access({directory: f.host})
  expect(() => reader.read({...document, path: "private.md"})).toThrow("files")
  expect(reader.source({package: document.package, export: "."})).toContain('throw new Error')
  expect(() => reader.source({package: document.package, export: "./src/document.md"})).toThrow()
})
test("ссылка не принимает абсолютный адрес и не выходит за границу владельца", () => {
  const f = fixture()
  const reader = access({directory: f.host})
  symlinkSync(join(f.owner, "private.md"), join(f.host, "escaped.md"))
  expect(() => reader.read({path: "escaped.md"})).toThrow("вне")
  expect(() => reader.read({...document, path: join(f.owner, "src/document.md")})).toThrow("относительный")
  expect(() => reader.read({...document, path: "../private.md"})).toThrow("относительный")
})
