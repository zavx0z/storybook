import {afterEach, expect, test} from "bun:test"
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import Compiler from "@build/compiler"
import BuildInputs from "@build/inputs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })

test("ancestor controls включают foreign tsconfig extends и остаются свежими между вызовами", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-compiler-controls-")))
  roots.push(root)
  const repo = join(root, "foreign")
  const owner = join(repo, "packages", "owner")
  const source = join(owner, "src", "index.tsx")
  const outsideBase = join(root, "shared", "base.json")
  const unrelatedParent = join(root, "tsconfig.json")
  const repoConfig = join(repo, "tsconfig.json")
  const packagesConfig = join(repo, "packages", "tsconfig.json")
  const repoBunfig = join(repo, "bunfig.toml")
  const ownerBunfig = join(owner, "bunfig.toml")
  const laterBunfig = join(repo, "packages", "bunfig.toml")
  for (const path of [source, outsideBase, unrelatedParent, repoConfig, packagesConfig, repoBunfig, ownerBunfig]) {
    mkdirSync(dirname(path), {recursive: true})
  }
  mkdirSync(join(repo, ".git"))
  writeFileSync(source, "export default function View() { return <div /> }\n")
  writeFileSync(outsideBase, JSON.stringify({compilerOptions: {jsxImportSource: "@zavx0z/jsx"}}))
  writeFileSync(unrelatedParent, JSON.stringify({compilerOptions: {jsxImportSource: "react"}}))
  writeFileSync(repoConfig, JSON.stringify({extends: "../shared/base.json"}))
  writeFileSync(packagesConfig, JSON.stringify({extends: "../tsconfig.json"}))
  writeFileSync(repoBunfig, "[install]\nlinker = 'hoisted'\n")
  writeFileSync(ownerBunfig, "[test]\npreload = []\n")

  const files = Compiler.resolveStorybookCompilerControlFiles([owner, source])
  expect(files).toEqual([outsideBase, ownerBunfig, packagesConfig, repoBunfig, repoConfig].sort())
  expect(files).not.toContain(unrelatedParent)
  const plan = BuildInputs.plan({
    identity: {owner: "foreign-controls"},
    roots: [],
    compilerRoots: [],
    files,
    compilerAdapterPath: source,
    toolchainFiles: [],
    validationAbi: {owner: "foreign-controls/1"},
  })
  const reader = new BuildInputs()
  const before = reader.read(plan)
  writeFileSync(outsideBase, JSON.stringify({compilerOptions: {jsxImportSource: "@zavx0z/jsx"}, changed: true}))
  expect(reader.read(plan).digest).not.toBe(before.digest)
  expect(Compiler.resolveStorybookCompilerControlFiles([owner])).toEqual(files)

  writeFileSync(laterBunfig, "[install]\nlinker = 'isolated'\n")
  expect(Compiler.resolveStorybookCompilerControlFiles([owner])).toContain(laterBunfig)
})
