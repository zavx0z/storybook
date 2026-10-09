import {afterEach, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Compiler from "@zavx0z/storybook-tech-build-compiler"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true})
})

describe.each([{name: "ESM scope", props: {type: "module"}}, {name: "CJS scope", props: {type: "commonjs"}}])("$name", ({props}) => {
  test("область модуля сохраняет именованного владельца и физическую идентичность", async () => {
    const root = await mkdtemp(join(tmpdir(), "storybook-module-scope-"))
    directories.push(root)
    const scope = join(root, "lib")
    await mkdir(scope)
    await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/library"}))
    await Bun.write(join(scope, "package.json"), JSON.stringify({type: props.type}))
    const file = join(scope, "index.js")
    await Bun.write(file, "export const value = 1\n")
    const owner = Compiler.readStorybookPackageRoot(root)
    expect(Compiler.readStorybookPackageOwner(file), "Служебный manifest не становится новым пакетом").toEqual(owner)
    expect(Compiler.tryCanonicalizeStorybookPackageFile(root, file), "Канонизация сохраняет файл внутри настоящего владельца").toBe(await realpath(file))
    expect(() => Compiler.readStorybookPackageRoot(scope), "Явно назначенный пакет всё ещё обязан иметь имя").toThrow("has no name")
    await Bun.write(join(scope, "package.json"), JSON.stringify({name: ""}))
    expect(() => Compiler.readStorybookPackageOwner(file), "Некорректное заданное имя не маскируется родителем").toThrow("has no name")
    await Bun.write(join(scope, "package.json"), "{broken")
    expect(() => Compiler.readStorybookPackageOwner(file), "Ошибка JSON остаётся ошибкой чтения").toThrow()
    await Bun.write(join(scope, "package.json"), "null")
    expect(() => Compiler.readStorybookPackageOwner(file), "Неверная форма manifest остаётся ошибкой").toThrow("must be an object")
    const unnamed = join(root, "node_modules/unnamed")
    await mkdir(unnamed, {recursive: true})
    await Bun.write(join(unnamed, "package.json"), JSON.stringify({type: props.type}))
    await Bun.write(join(unnamed, "index.js"), "export const value = 2")
    expect(Compiler.readStorybookPackageOwner(join(unnamed, "index.js")), "Безымянная установленная зависимость не присваивается потребителю").toBeNull()
    await Bun.write(join(scope, "package.json"), JSON.stringify({name: "@fixture/nested"}))
    expect(Compiler.tryCanonicalizeStorybookPackageFile(root, file), "Отдельный именованный пакет не присваивается родителю").toBeNull()
  })
})
