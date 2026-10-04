import {expect, test} from "bun:test"
import {link, mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readPackage from "@zavx0z/storybook-package-reader"

test("учитывает самостоятельные src-входы своего пакета без исполнения и чужих исходников", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-owned-sources-")))
  const owner = join(root, "owner")
  const external = join(root, "external")
  const sentinel = join(root, "must-not-execute")
  try {
    await mkdir(join(owner, "src/child"), {recursive: true})
    await mkdir(join(owner, "src/fixture"), {recursive: true})
    await mkdir(external)
    await Bun.write(join(owner, "package.json"), JSON.stringify({name: "@fixture/owner", type: "module", exports: {".": "./index.ts"}}))
    await Bun.write(join(owner, "index.ts"), "export default function owner() { return true }\n")
    await Bun.write(join(owner, "src/worker.ts"), `import {writeFileSync} from "node:fs"\nwriteFileSync(${JSON.stringify(sentinel)}, "")\nexport function worker() { return 1 }\n`)
    await Bun.write(join(owner, "src/check.test.ts"), 'throw new Error("Test must not be read as production")\n')
    await Bun.write(join(owner, "src/fixture/index.ts"), "export const fixture = true\n")
    await Bun.write(join(owner, "src/child/package.json"), JSON.stringify({name: "@fixture/child"}))
    await Bun.write(join(owner, "src/child/index.ts"), "export const child = true\n")
    await Bun.write(join(external, "index.ts"), "export const outside = true\n")
    await symlink(external, join(owner, "src/linked"))
    const result = await readPackage({path: owner})
    expect(result.code.map(source => source.path), "Вне import-цепочки остаётся собственный исполняемый worker")
      .toEqual([join(owner, "index.ts"), join(owner, "src/worker.ts")])
    expect(result.code[1]!.references.map(reference => reference.module), "Зависимости самостоятельного входа входят в те же структурные факты")
      .toEqual(["node:fs"])
    expect(await Bun.file(sentinel).exists(), "Сбор фактов не запускает worker").toBeFalse()
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("hardlink-копия исходника не переносит его к владельцу другой копии", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-source-hardlink-")))
  const owner = join(root, "owner")
  const mirror = join(root, "mirror")
  try {
    await mkdir(join(owner, "src"), {recursive: true})
    await mkdir(mirror)
    await Bun.write(join(owner, "package.json"), JSON.stringify({name: "@fixture/owner", exports: {".": "./index.ts"}}))
    await Bun.write(join(mirror, "package.json"), JSON.stringify({name: "@fixture/mirror"}))
    await Bun.write(join(mirror, "value.ts"), "export default function value() { return 1 }\n")
    const source = join(owner, "src/value.ts")
    await link(join(mirror, "value.ts"), source)
    await Bun.write(join(owner, "index.ts"), 'export {default} from "./src/value"\n')
    const result = await readPackage({path: owner})
    expect(result.code.map(item => item.path), "Набор кода сохраняет адреса выбранного владельца").toEqual([join(owner, "index.ts"), source])
    expect(result.code[0]!.exports[0]!.declarations, "Общий inode файла не заменяет принадлежность физическому пакету")
      .toEqual([{path: source, owner: {name: "@fixture/owner", path: owner}}])
    expect(result.code[0]!.references[0], "Относительный импорт продолжает обозначать собственный модуль")
      .toMatchObject({module: "./src/value", path: source, owner: {name: "@fixture/owner", path: owner}, public: true})
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
