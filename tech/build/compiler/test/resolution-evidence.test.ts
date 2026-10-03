import {afterEach, expect, test} from "bun:test"
import Compiler from "@build/compiler"
import {linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "resolved-owner-evidence-")))
  roots.push(root)
  const scope = join(root, "dist/esm")
  mkdirSync(scope, {recursive: true})
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/runtime", version: "1.0.0", type: "commonjs"}))
  const manifest = join(scope, "package.json")
  writeFileSync(manifest, JSON.stringify({type: "module"}))
  const source = join(scope, "index.js")
  writeFileSync(source, "export const value = true\n")
  return {root, manifest, source}
}

test("известный named owner сохраняет nameless npm scope, default discovery остаётся строгим", () => {
  const {root, source, manifest} = fixture()
  const read = Compiler.readStorybookResolutionEvidence
  expect(() => read({files: [source]})).toThrow("owner package has no name")
  const before = read({files: [source], ownerRoots: [root]})
  writeFileSync(manifest, JSON.stringify({type: "commonjs"}))
  expect(read({files: [source], ownerRoots: [root]})).not.toEqual(before)
})

test("известные owner roots не скрывают посторонний файл или более близкий named owner", () => {
  const {root, source, manifest} = fixture()
  const outside = fixture()
  const read = Compiler.readStorybookResolutionEvidence
  expect(() => read({files: [source, outside.source], ownerRoots: [root]})).toThrow("belongs to no supplied owner")
  expect(() => read({files: [source], ownerRoots: [`${root}/.`]})).toThrow("must be canonical")
  writeFileSync(manifest, JSON.stringify({name: "@fixture/nested", type: "module"}))
  expect(() => read({files: [source], ownerRoots: [root]})).toThrow("skips a named package")
})

test("новый вызов видит lock, вложенного named owner и замену source symlink", () => {
  const {root, source} = fixture()
  const second = join(root, "dist/esm/second.js")
  writeFileSync(second, "export const second = true\n")
  const read = () => Compiler.readStorybookResolutionEvidence({files: [source, second], ownerRoots: [root]})
  const initial = read()
  const lockPath = join(root, "bun.lock")
  writeFileSync(lockPath, JSON.stringify({lockfileVersion: 1, workspaces: {
    "": {dependencies: {"@fixture/runtime": "workspace:*"}},
  }, packages: {}}))
  const withLock = read()
  expect(withLock).not.toEqual(initial)
  expect(withLock.locks).toHaveLength(1)
  writeFileSync(lockPath, JSON.stringify({lockfileVersion: 2, workspaces: {
    "": {dependencies: {"@fixture/runtime": "workspace:*"}},
  }, packages: {}}))
  expect(read()).not.toEqual(withLock)

  const nested = join(root, "dist/esm/nested")
  mkdirSync(nested)
  const nestedSource = join(nested, "child.js")
  writeFileSync(nestedSource, "export const child = true\n")
  const nestedManifest = join(nested, "package.json")
  writeFileSync(nestedManifest, JSON.stringify({name: "@fixture/new-owner"}))
  expect(() => Compiler.readStorybookResolutionEvidence({files: [source, nestedSource], ownerRoots: [root]}))
    .toThrow("skips a named package")

  const link = join(root, "dist/esm/link.js")
  symlinkSync(source, link)
  expect(() => Compiler.readStorybookResolutionEvidence({files: [source, link], ownerRoots: [root]}))
    .toThrow("exact non-symlink file")
  unlinkSync(link)
  linkSync(source, link)
  expect(Compiler.readStorybookResolutionEvidence({files: [source, link], ownerRoots: [root]}))
    .toEqual(Compiler.readStorybookResolutionEvidence({files: [source], ownerRoots: [root]}))
})
