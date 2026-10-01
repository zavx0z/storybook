import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, writeFile, rm, symlink, realpath} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readPackage from "@archetypes/package"
import readPackageJson from "@archetypes/package-json"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Подготавливает пакет области с самостоятельным компонентом без выполнения его кода. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "archetype-composition-")))
  roots.push(root)
  await mkdir(join(root, "button/contract"), {recursive: true})
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@fixture/ui", description: "Область", workspaces: ["button"],
    exports: {"./button": "./button/index.ts"},
  }))
  await writeFile(join(root, "button/package.json"), JSON.stringify({name: "@fixture/button", exports: "./index.ts"}))
  await writeFile(join(root, "button/index.ts"), 'throw new Error("Не исполнять")')
  await writeFile(join(root, "button/contract/input.ts"), "export interface Input {}")
  return root
}

test("прямой подпуть домена сохраняет владельца реализации и его контракт", async () => {
  const root = await fixture()
  const result = await readPackage({path: root})
  expect(result.packages).toEqual([{path: join(root, "button"), name: "@fixture/button", parent: root}])
  expect(result.index.entries[0]).toMatchObject({status: "forwarded", input: "./button/contract/input.ts", output: null,
    owner: {path: join(root, "button"), name: "@fixture/button", export: "."}})
})

test("частный файл вложенного пакета не становится публичным через родителя", async () => {
  const root = await fixture()
  await writeFile(join(root, "button/private.ts"), "export const value = 1")
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/ui", exports: {"./private": "./button/private.ts"}}))
  expect((await readPackage({path: root})).index.entries[0]).toMatchObject({status: "nested-package", input: null, output: null})
})

test("исчезнувшая цель и symlink вложенного владельца не открывают соседние данные", async () => {
  const root = await fixture()
  await rm(join(root, "button/index.ts"))
  expect((await readPackage({path: root})).index.entries[0]?.status).toBe("nested-package")
  await writeFile(join(root, "secret.ts"), "export const secret = 42")
  await symlink(join(root, "secret.ts"), join(root, "button/index.ts"))
  expect((await readPackage({path: root})).index.entries[0]?.status).toBe("nested-package")
})

test("Repo и Domain не обязаны объявлять исполняемый exports", async () => {
  const root = await fixture()
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/ui", workspaces: ["button"]}))
  const result = await readPackage({path: root})
  expect(result.index.entries).toEqual([])
  expect(result.packages).toHaveLength(1)
  expect(result.packageJson.description).toBe("")
})

test("неизвестный формат exports сохраняет непроверенную ветвь", async () => {
  const root = await fixture()
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/ui", exports: ["./one.ts", "./two.ts"]}))
  const result = await readPackage({path: root})
  expect(result.index.unchecked).toHaveLength(1)
  expect(await readPackageJson({path: join(root, "button/package.json")})).toMatchObject({exports: {".": "./index.ts"}})
})

test("повторное имя разных вложенных владельцев отклоняется", async () => {
  const root = await fixture()
  await mkdir(join(root, "other"))
  await writeFile(join(root, "other/package.json"), JSON.stringify({name: "@fixture/button"}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/ui", workspaces: ["button", "other"]}))
  await expect(readPackage({path: root})).rejects.toThrow("Повторная идентичность")
})

test("Domain выводит вложенный состав из корневого glob Repo", async () => {
  const root = await fixture()
  await mkdir(join(root, "button/icon"))
  await writeFile(join(root, "button/icon/package.json"), JSON.stringify({name: "@fixture/icon", exports: "./index.ts"}))
  await writeFile(join(root, "button/icon/index.ts"), "export default function Icon() {}")
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/repo", workspaces: ["**"]}))
  const domain = await readPackage({path: join(root, "button")})
  expect(domain.packageJson.workspaces).toBeUndefined()
  expect(domain.packages).toEqual([{path: join(root, "button/icon"), name: "@fixture/icon", parent: join(root, "button")}])
})
