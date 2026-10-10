import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import readPackage from "../index.ts"
import readContract from "@zavx0z/storybook-contracts"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"
import {sourceExports} from "../src/source-index"

test("source projection сохраняет identity неизменённых exports и настоящие условия сред", () => {
  const unchanged = {".": {browser: "./browser.ts", node: "./node.ts"}, "./theme.css": "./theme.css"}
  expect(sourceExports(unchanged)).toBe(unchanged)
  const exports = {".": {browser: {source: "./browser.ts", types: "./browser.d.ts", default: "./browser.js"}, node: {source: "./node.ts", default: "./node.js"}}, "./theme.css": "./theme.css"}
  expect(sourceExports(exports)).toEqual({".": {browser: "./browser.ts", node: "./node.ts"}, "./theme.css": "./theme.css"})
  const fallback = {".": [{source: "./source.ts", default: "./ready.js"}, "./fallback.js"]}
  expect(sourceExports(fallback)).toEqual({".": ["./source.ts", "./fallback.js"]})
  const unchangedFallback = {".": ["./first.js", "./second.js"]}
  expect(sourceExports(unchangedFallback)).toBe(unchangedFallback)
})

test("raw index сохраняет ready paths, authoring code/contracts читают только явный source", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-source-index-")))
  const exports = {".": {source: "./index.ts", types: "./dist/index.d.ts", browser: "./dist/index.js", default: "./dist/index.js"}}
  try {
    await mkdir(join(root, "contract"))
    await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/source-index", description: "Авторский вход", exports}))
    await Bun.write(join(root, "index.ts"), '/** Авторская возможность.\n@packageDocumentation\n*/\nimport type {SourceIndex} from "./contract"\nexport type {SourceIndex} from "./contract"\nexport default function value(): SourceIndex.Output {return {value: 3}}\n')
    await Bun.write(join(root, "contract/index.ts"), "export declare namespace SourceIndex {interface Output {value: number}}\n")
    await Bun.write(join(root, "dist/index.js"), 'export {default} from "../../another-owner/index.js"\n')
    await Bun.write(join(root, "dist/index.d.ts"), 'export {default} from "../../another-owner/index.js"\n')
    const result = await readPackage({path: root})
    expect(result.packageJson.exports).toEqual(exports)
    expect(result.index.entries.map(entry => entry.conditions)).toEqual([["source"], ["types"], ["browser"], ["default"]])
    expect(result.index.entries.every(entry => entry.status === "owned")).toBeTrue()
    expect(result.sourceIndex.entries.map(entry => [entry.target, entry.conditions])).toEqual([["./index.ts", []]])
    expect(result.entryDocumentation.map(entry => entry.target)).toEqual(["./index.ts"])
    expect(result.code.map(entry => entry.path)).toEqual([join(root, "index.ts"), join(root, "contract/index.ts")])
    expect(result.code.flatMap(entry => entry.references).some(reference => reference.module.includes("another-owner"))).toBeFalse()
    const contract = await readContract({path: root})
    expect(contract.entries.map(entry => entry.path)).toEqual([join(root, "index.ts")])
    await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/source-index", exports: {".": "./index.ts"}}))
    const simple = await readPackage({path: root})
    expect(simple.sourceIndex).toBe(simple.index)
  } finally { await rm(root, {recursive: true, force: true}) }
}, 30000)

test("реальный authored Button проходит Package verification без требований к generated facades", async () => {
  const report = await readScenario({path: resolve(import.meta.dir, "../spec/scenario.spec.ts"), props: {path: resolve(import.meta.dir, "../../../../immersive/ui/component/button/basic")}})
  expect(report.tests.filter(test => test.status === "failed").map(test => test.label), report.stderr).toEqual([])
  expect(report.exitCode, report.stderr).toBe(0)
}, 60000)
