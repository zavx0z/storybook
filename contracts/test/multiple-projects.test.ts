import {expect, test} from "bun:test"
import {mkdir, symlink} from "node:fs/promises"
import {resolve} from "node:path"
import readContract from "@zavx0z/storybook-contracts"
import {createFixture} from "./fixture"

test("переадресованные входы проверяются в собственных TypeScript проектах", async () => {
  const fixture = await createFixture("empty")
  try {
    await fixture.write("package.json", JSON.stringify({name: "@fixture/group", type: "module", exports: {".": "./index.ts", "./child": "./child/index.ts"}}))
    await fixture.write("tsconfig.json", JSON.stringify({compilerOptions: {strict: false, module: "ESNext", moduleResolution: "Bundler"}, include: ["index.ts"]}))
    await fixture.write("index.ts", 'export {default as Child} from "@fixture/child"\nexport type {FixtureChild} from "@fixture/child"\n')
    await fixture.write("child/package.json", JSON.stringify({name: "@fixture/child", type: "module", exports: {".": "./index.ts"}}))
    await fixture.write("child/tsconfig.json", JSON.stringify({compilerOptions: {strict: true, module: "ESNext", moduleResolution: "Bundler"}, include: ["index.ts", "contract/**/*.ts"]}))
    const entry = 'import type {FixtureChild} from "./contract"\nexport type {FixtureChild} from "./contract"\nexport default function child(value: FixtureChild.Input): FixtureChild.Output {return value.value}\n'
    await fixture.write("child/index.ts", entry)
    await fixture.write("child/contract/index.ts", 'export declare namespace FixtureChild {interface Input {readonly value: number}\ntype Output = number}\n')
    await mkdir(resolve(fixture.root, "node_modules/@fixture"), {recursive: true})
    await symlink(resolve(fixture.root, "child"), resolve(fixture.root, "node_modules/@fixture/child"))
    const result = await readContract({path: fixture.root})
    expect(result.entries.map(entry => entry.exportPath)).toEqual([".", "./child"])
    expect(result.diagnostics).toEqual([fixture.namingDiagnostic("FixtureChild", "child")])
    await fixture.write("child/index.ts", entry + 'function privateHelper(value) {return value}\n')
    const invalid = await readContract({path: fixture.root})
    expect(invalid.diagnostics.some(diagnostic => diagnostic.code === "typescript-7006"
      && diagnostic.path === resolve(fixture.root, "child/index.ts")),
      "Строгий проект ребёнка проверяется даже при нестрогом проекте фасада").toBeTrue()
  } finally {
    await fixture.close()
  }
}, 30_000)
