import BuildInputs from "@build/inputs"
import {afterAll, describe, expect, test} from "bun:test"
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {beginStorybookSharedBuildInputAttestation, resolveStorybookSharedBuildInputFingerprintPlan} from "../src/plan"

const toolRoot = realpathSync(join(import.meta.dir, "../../../.."))
const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, {recursive: true, force: true}) })

describe("shared browser build input plan", () => {
  test("shared plan учитывает два entrypoints, config, ambient source и same-byte restore", () => {
    const fixture = createSharedFixture()
    const compute = createPlanComputer()
    const request = {
      toolRoot: fixture.root,
      landingEntryPath: fixture.landing,
      fallbackEntryPath: fixture.fallback,
    }
    const fingerprint = (): ReturnType<typeof compute> => compute(
      resolveStorybookSharedBuildInputFingerprintPlan(request),
    )
    const baseline = fingerprint()
    const plan = resolveStorybookSharedBuildInputFingerprintPlan(request)

    expect(plan.identity).toEqual({
      owner: "shared-browser",
      toolRoot: realpathSync(fixture.root),
      landingEntryPath: realpathSync(fixture.landing),
      fallbackEntryPath: realpathSync(fixture.fallback),
    })
    expect(plan.identity).not.toHaveProperty("descriptor")
    expect(fingerprint().digest).toBe(baseline.digest)

    writeFileSync(fixture.landing, "export const landing = 'changed'\n")
    expect(fingerprint().digest).not.toBe(baseline.digest)
    writeFileSync(fixture.landing, fixture.landingSource)

    writeFileSync(fixture.tsconfigBase, JSON.stringify({compilerOptions: {jsxImportSource: "react"}}))
    expect(fingerprint().digest).not.toBe(baseline.digest)
    writeFileSync(fixture.tsconfigBase, fixture.tsconfigSource)

    writeFileSync(fixture.globalTypes, "declare global { const sharedAmbient: 'changed' }\nexport {}\n")
    expect(fingerprint().digest).not.toBe(baseline.digest)
    writeFileSync(fixture.globalTypes, fixture.globalTypesSource)

    rmSync(fixture.fallback)
    writeFileSync(fixture.fallback, fixture.fallbackSource)
    expect(fingerprint().digest).toBe(baseline.digest)
  })

  test("foreign ancestor configs и extends attested заранее, соседний файл не получает разрешение", async () => {
    const fixture = createSharedFixture()
    const foreign = realpathSync(mkdtempSync(join(tmpdir(), "storybook-foreign-config-")))
    roots.push(foreign)
    const owner = join(foreign, "owner")
    mkdirSync(owner)
    mkdirSync(join(foreign, ".git"))
    writeFileSync(join(owner, "package.json"), JSON.stringify({name: "@fixture/foreign-config", exports: "./index.ts"}))
    writeFileSync(join(owner, "index.ts"), "export const value = 1\n")
    const config = join(foreign, "tsconfig.json")
    const base = join(foreign, "base.json")
    writeFileSync(join(owner, "tsconfig.json"), JSON.stringify({extends: "../tsconfig.json"}))
    writeFileSync(config, JSON.stringify({extends: "./base.json"}))
    writeFileSync(base, JSON.stringify({compilerOptions: {strict: true}}))
    const neighbor = join(foreign, "unselected.ts")
    writeFileSync(neighbor, "export const unrelated = true\n")
    const manifest = join(fixture.root, "package.json")
    writeFileSync(manifest, JSON.stringify({...JSON.parse(readFileSync(manifest, "utf8")),
      dependencies: {"@fixture/foreign-config": `file:${owner}`},
    }))
    const request = {toolRoot: fixture.root, landingEntryPath: fixture.landing, fallbackEntryPath: fixture.fallback}
    const plan = resolveStorybookSharedBuildInputFingerprintPlan(request)
    expect(plan.scope.files).toContain(config)
    expect(plan.scope.files).toContain(base)
    expect(plan.scope.guardRoots).not.toContain(foreign)
    const stable = await beginStorybookSharedBuildInputAttestation(request)
    try {
      expect(stable.before.files.map(file => file.path)).toContain(base)
      expect((await stable.complete([config, base])).digest).toBe(stable.before.digest)
    } finally { stable.dispose() }
    const escaped = await beginStorybookSharedBuildInputAttestation(request)
    try { await expect(escaped.complete([neighbor])).rejects.toThrow("escaped attested owner roots") }
    finally { escaped.dispose() }
    const changed = await beginStorybookSharedBuildInputAttestation(request)
    try {
      writeFileSync(base, JSON.stringify({compilerOptions: {strict: false}}))
      await expect(changed.complete([base])).rejects.toThrow("changed during compilation")
    } finally { changed.dispose() }
  })

})

/** Создаёт shared compiler owner с двумя entrypoints без package build descriptor. */
function createSharedFixture(): Readonly<{
  root: string
  landing: string
  landingSource: string
  fallback: string
  fallbackSource: string
  tsconfigBase: string
  tsconfigSource: string
  globalTypes: string
  globalTypesSource: string
}> {
  const root = mkdtempSync(join(tmpdir(), "storybook-shared-fingerprint-"))
  roots.push(root)
  symlinkSync(join(toolRoot, "node_modules"), join(root, "node_modules"))
  const jsxRoot = realpathSync(join(import.meta.dir, "../../../../../immersive/jsx"))
  const landing = join(root, "landing.ts")
  const fallback = join(root, "fallback.ts")
  const landingSource = "export const landing = true\n"
  const fallbackSource = "export const fallback = true\n"
  const tsconfigBase = join(root, "tsconfig.base.json")
  const tsconfigSource = JSON.stringify({compilerOptions: {jsxImportSource: "@zavx0z/jsx"}})
  const globalTypes = join(root, "global.d.ts")
  const globalTypesSource = "declare global { const sharedAmbient: true }\nexport {}\n"
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@fixture/shared-fingerprint",
    devDependencies: {"@zavx0z/jsx": `file:${jsxRoot}`},
  }))
  writeFileSync(landing, landingSource)
  writeFileSync(fallback, fallbackSource)
  writeFileSync(tsconfigBase, tsconfigSource)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({extends: "./tsconfig.base.json"}))
  writeFileSync(globalTypes, globalTypesSource)
  return Object.freeze({
    root,
    landing,
    landingSource,
    fallback,
    fallbackSource,
    tsconfigBase,
    tsconfigSource,
    globalTypes,
    globalTypesSource,
  })
}


/** Создаёт отдельный кэш чтения для группы сравнений планов. */
function createPlanComputer() {
  const reader = new BuildInputs()
  return (plan: Parameters<typeof BuildInputs.read>[0]) => reader.read(plan)
}
