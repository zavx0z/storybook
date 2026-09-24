import {afterAll, describe, expect, setDefaultTimeout, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
  beginStorybookBuildInputAttestation,
  createStorybookBuildInputFingerprintComputer,
  createStorybookBuildInputFingerprintPlanComputer,
  computeStorybookBuildInputFingerprintPlan,
  parseStorybookBuildInputFingerprint,
  resolveStorybookPackageBuildInputFingerprintPlan,
  resolveStorybookSharedBuildInputFingerprintPlan,
  sameStorybookBuildInputFingerprint,
  storybookBuildInputFingerprintWatchPaths,
} from "./build-input-fingerprint.ts"
import {createStorybookBuildInputFingerprintVerifier} from "./package-build.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"

const roots: string[] = []
setDefaultTimeout(60_000)

afterAll(() => {
  for (const root of roots) rmSync(root, {recursive: true, force: true})
})

describe("Storybook build input fingerprint", () => {
  test("инвалидирует source, config, inventory и external closure без compiler child", () => {
    const fixture = createFixture()
    const compute = createStorybookBuildInputFingerprintComputer()
    const request = {
      descriptor: fixture.descriptor,
      browserEntryPath: fixture.browserEntry,
      additionalFilePaths: [fixture.externalDependency],
    }
    const baseline = compute(request)
    const unchanged = compute(request)
    const packagePlan = resolveStorybookPackageBuildInputFingerprintPlan(request)
    const watchPaths = storybookBuildInputFingerprintWatchPaths(baseline)

    expect(sameStorybookBuildInputFingerprint(baseline, unchanged)).toBeTrue()
    expect(computeStorybookBuildInputFingerprintPlan(packagePlan).digest).toBe(baseline.digest)
    expect(baseline.protocol).toBe(STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL)
    expect(baseline.files.map(({path}) => path)).toContain(realpathSync(fixture.externalDependency))
    expect(watchPaths).toContain(realpathSync(fixture.nestedDirectory))

    writeFileSync(fixture.module, "export const module = {changed: true}\n")
    expect(compute(request).digest).not.toBe(baseline.digest)
    writeFileSync(fixture.module, fixture.moduleSource)

    writeFileSync(fixture.tsconfigBase, JSON.stringify({compilerOptions: {jsxImportSource: "react"}}))
    expect(compute(request).digest).not.toBe(baseline.digest)
    writeFileSync(fixture.tsconfigBase, fixture.tsconfigSource)

    writeFileSync(fixture.globalTypes, "declare global { const ambientFingerprint: 'changed' }\nexport {}\n")
    expect(compute(request).digest).not.toBe(baseline.digest)
    writeFileSync(fixture.globalTypes, fixture.globalTypesSource)

    const nestedAmbient = join(fixture.nestedDirectory, "new-global.d.ts")
    writeFileSync(nestedAmbient, "declare global { const nestedAmbient: true }\nexport {}\n")
    expect(compute(request).digest).not.toBe(baseline.digest)
    rmSync(nestedAmbient)

    const added = join(fixture.root, "new-resolution-candidate.ts")
    writeFileSync(added, "export const candidate = true\n")
    expect(compute(request).digest).not.toBe(baseline.digest)
    rmSync(added)

    const externalCandidate = join(fixture.externalRoot, "dependency.js")
    writeFileSync(externalCandidate, "export const shadow = true\n")
    expect(compute(request).digest).not.toBe(baseline.digest)
    rmSync(externalCandidate)

    writeFileSync(fixture.externalDependency, "export const external = 'changed'\n")
    expect(compute(request).digest).not.toBe(baseline.digest)
  })

  test("old, malformed и mismatched evidence дают cold fallback", () => {
    const fixture = createFixture()
    const compute = createStorybookBuildInputFingerprintComputer()
    const request = {
      descriptor: fixture.descriptor,
      browserEntryPath: fixture.browserEntry,
    }
    const evidence = compute(request)
    const verify = createStorybookBuildInputFingerprintVerifier({
      browserEntryPath: fixture.browserEntry,
    })

    expect(verify(evidence, fixture.descriptor)?.digest).toBe(evidence.digest)
    expect(verify({...evidence, protocol: "storybook-build-input/0"}, fixture.descriptor)).toBeNull()
    expect(parseStorybookBuildInputFingerprint({...evidence, digest: "0".repeat(64)})).toBeNull()
    expect(storybookBuildInputFingerprintWatchPaths({...evidence, watchDirectories: undefined})).toBeNull()

    writeFileSync(fixture.module, "export const module = {mismatch: true}\n")
    expect(verify(evidence, fixture.descriptor)).toBeNull()
  })

  test("transient concurrent source change invalidates attestation, staging output does not", async () => {
    const fixture = createFixture()
    const stagingDirectory = join(fixture.root, ".candidate")
    const input = {
      descriptor: fixture.descriptor,
      browserEntryPath: fixture.browserEntry,
      stagingDirectory,
    }
    const stable = await beginStorybookBuildInputAttestation(input)
    mkdirSync(stagingDirectory, {recursive: true})
    writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
    const stableFingerprint = await stable.complete()
    expect(stableFingerprint).toMatchObject({
      protocol: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    })
    stable.dispose()

    const changed = await beginStorybookBuildInputAttestation(input)
    writeFileSync(fixture.module, "export const transient = true\n")
    writeFileSync(fixture.module, fixture.moduleSource)
    await Bun.sleep(10)
    await expect(changed.complete()).rejects.toThrow("changed during compilation")
    changed.dispose()
  })

  test("shared plan учитывает два entrypoints, config, ambient source и same-byte restore", () => {
    const fixture = createSharedFixture()
    const compute = createStorybookBuildInputFingerprintPlanComputer()
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

  test("guard заранее охватывает hoisted workspace dependency и отклоняет transient change", async () => {
    const fixture = createHoistedDependencyFixture()
    const input = {
      descriptor: fixture.descriptor,
      browserEntryPath: fixture.browserEntry,
    }
    const plan = resolveStorybookPackageBuildInputFingerprintPlan(input)
    const dependencyRoot = realpathSync(fixture.dependencyRoot)

    expect(plan.scope.roots.some((root) => dependencyRoot.startsWith(`${root}/`))).toBeFalse()
    expect(plan.scope.guardRoots).toContain(dependencyRoot)

    const attestation = await beginStorybookBuildInputAttestation(input)
    writeFileSync(fixture.dependency, "export const hoisted = 'changed'\n")
    writeFileSync(fixture.dependency, fixture.dependencySource)
    await Bun.sleep(10)
    await expect(attestation.complete([fixture.dependency])).rejects.toThrow("changed during compilation")
    attestation.dispose()
  })
})

/** Создаёт minimal package descriptor, сохраняя реальные private build entry inputs. */
function createFixture(): Readonly<{
  root: string
  module: string
  moduleSource: string
  tsconfigBase: string
  tsconfigSource: string
  browserEntry: string
  externalDependency: string
  externalRoot: string
  globalTypes: string
  globalTypesSource: string
  nestedDirectory: string
  descriptor: StorybookPackageBuildDescriptor
}> {
  const root = mkdtempSync(join(tmpdir(), "storybook-fingerprint-"))
  const externalRoot = mkdtempSync(join(tmpdir(), "storybook-fingerprint-external-"))
  roots.push(root, externalRoot)
  const sourcePath = join(root, "package.json")
  const module = join(root, "module/spec/scenario.spec.ts")
  const moduleSource = "export const scenario = true\n"
  const tsconfigBase = join(root, "tsconfig.base.json")
  const tsconfigSource = JSON.stringify({compilerOptions: {jsxImportSource: "@zavx0z/template"}})
  const browserEntry = join(import.meta.dir, "../runtime/package-entry.ts")
  const externalDependency = join(externalRoot, "dependency.ts")
  const globalTypes = join(root, "global.d.ts")
  const globalTypesSource = "declare global { const ambientFingerprint: true }\nexport {}\n"
  const nestedDirectory = join(root, "types", "nested")
  mkdirSync(nestedDirectory, {recursive: true})
  mkdirSync(join(root, "module/spec"), {recursive: true})
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@fixture/fingerprint",
    devDependencies: {"@zavx0z/template": "0.0.0"},
  }))
  writeFileSync(module, moduleSource)
  writeFileSync(tsconfigBase, tsconfigSource)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({extends: "./tsconfig.base.json"}))
  writeFileSync(externalDependency, "export const external = true\n")
  writeFileSync(globalTypes, globalTypesSource)
  const descriptor = {
    packageId: "@fixture/fingerprint",
    packageRoot: root,
    projectRoot: root,
    sourcePath,
    declarationDigest: "fixture-declaration",
    graphSnapshot: {
      protocol: "storybook-package-graph/5",
      packageId: "@fixture/fingerprint",
      declarationDigest: "fixture-declaration",
      packageGraphDigest: "fixture-graph",
    },
    resourceFiles: [],
    scenarioSpecs: [{nodeId: "directory:package:@fixture/fingerprint/module", sourcePaths: [module]}],
    watchedPaths: [module],
  } as unknown as StorybookPackageBuildDescriptor
  return Object.freeze({
    root,
    module,
    moduleSource,
    tsconfigBase,
    tsconfigSource,
    browserEntry,
    externalDependency,
    externalRoot,
    globalTypes,
    globalTypesSource,
    nestedDirectory,
    descriptor,
  })
}

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
  const templateRoot = realpathSync(join(import.meta.dir, "../../webxr-space/template"))
  const landing = join(root, "landing.ts")
  const fallback = join(root, "fallback.ts")
  const landingSource = "export const landing = true\n"
  const fallbackSource = "export const fallback = true\n"
  const tsconfigBase = join(root, "tsconfig.base.json")
  const tsconfigSource = JSON.stringify({compilerOptions: {jsxImportSource: "@zavx0z/template"}})
  const globalTypes = join(root, "global.d.ts")
  const globalTypesSource = "declare global { const sharedAmbient: true }\nexport {}\n"
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@fixture/shared-fingerprint",
    devDependencies: {"@zavx0z/template": `file:${templateRoot}`},
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

/** Создаёт nested package, разрешающий npm source из hoisted workspace node_modules. */
function createHoistedDependencyFixture(): Readonly<{
  dependencyRoot: string
  dependency: string
  dependencySource: string
  browserEntry: string
  descriptor: StorybookPackageBuildDescriptor
}> {
  const workspace = mkdtempSync(join(tmpdir(), "storybook-hoisted-fingerprint-"))
  roots.push(workspace)
  mkdirSync(join(workspace, ".git"), {recursive: true})
  const packageRoot = join(workspace, "packages", "owner")
  const dependencyRoot = join(workspace, "node_modules")
  const dependencyPackage = join(
    dependencyRoot,
    ".bun",
    "@fixture+hoisted@1.0.0",
    "node_modules",
    "@fixture",
    "hoisted",
  )
  mkdirSync(packageRoot, {recursive: true})
  mkdirSync(join(dependencyPackage, "dist"), {recursive: true})
  const sourcePath = join(packageRoot, "package.json")
  const module = join(packageRoot, "module.ts")
  const dependency = join(dependencyPackage, "dist", "index.js")
  const dependencySource = "export const hoisted = true\n"
  const browserEntry = join(import.meta.dir, "../runtime/package-entry.ts")
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "@fixture/nested-owner",
    devDependencies: {"@zavx0z/template": "0.0.0"},
  }))
  writeFileSync(join(packageRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {jsxImportSource: "@zavx0z/template"},
  }))
  writeFileSync(join(dependencyPackage, "package.json"), JSON.stringify({
    name: "@fixture/hoisted",
    exports: {".": "./dist/index.js"},
  }))
  writeFileSync(module, "export const module = true\n")
  writeFileSync(dependency, dependencySource)
  const descriptor = {
    packageId: "@fixture/nested-owner",
    packageRoot,
    projectRoot: packageRoot,
    sourcePath,
    declarationDigest: "nested-declaration",
    graphSnapshot: {
      protocol: "storybook-package-graph/5",
      packageId: "@fixture/nested-owner",
      declarationDigest: "nested-declaration",
      packageGraphDigest: "nested-graph",
    },
    resourceFiles: [],
    watchedPaths: [module],
  } as unknown as StorybookPackageBuildDescriptor
  return Object.freeze({
    dependencyRoot,
    dependency,
    dependencySource,
    browserEntry,
    descriptor,
  })
}
