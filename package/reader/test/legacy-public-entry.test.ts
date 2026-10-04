import {expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import readPackage from "@zavx0z/storybook-package-reader"

test("native types/typings подтверждают корневой вход зависимости без exports", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "package-legacy-entry-")))
  try {
    const dependency = resolve(root, "node_modules/legacy")
    await mkdir(dependency, {recursive: true})
    await Bun.write(resolve(root, "package.json"), JSON.stringify({name: "@fixture/consumer", exports: {".": "./index.ts"}, dependencies: {legacy: "1.0.0"}}))
    await Bun.write(resolve(root, "index.ts"), 'import type {Value} from "legacy"\nexport default function read(value: Value) {return value.name}\n')
    await Bun.write(resolve(dependency, "index.d.ts"), 'export interface Value {readonly name: string}\n')
    for (const field of ["types", "typings"]) {
      await Bun.write(resolve(dependency, "package.json"), JSON.stringify({name: "legacy", [field]: "index.d.ts"}))
      const result = await readPackage({path: root})
      expect(result.code[0]?.references[0]?.public).toBeTrue()
    }
    await Bun.write(resolve(dependency, "private.d.ts"), 'export interface Value {readonly name: string}\n')
    await Bun.write(resolve(root, "index.ts"), 'import type {Value} from "legacy/private"\nexport default function read(value: Value) {return value.name}\n')
    expect((await readPackage({path: root})).code[0]?.references[0]?.public).not.toBeTrue()
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
