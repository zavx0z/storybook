import {afterEach, describe, expect, setDefaultTimeout, test} from "bun:test"
import {createHash} from "node:crypto"
import {linkSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, watch, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {canonicalizeStorybookPackageIdentities, createStorybookPackageRevisionBuilder, isolatedStorybookSharedModuleEpoch} from "./package-build.ts"
import {STORYBOOK_PACKAGE_GRAPH_PROTOCOL, type StorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"

const roots: string[] = []
setDefaultTimeout(60_000)
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })

describe("structural package revision build", () => {
  test("copies a binary resource without changing its source", async () => {
    const fixture = createFixture()
    const sourcePath = join(fixture.packageRoot, "image.gif")
    const bytes = Buffer.from("GIF89a\u0000\u0001\u0002", "binary")
    writeFileSync(sourcePath, bytes)
    await Bun.sleep(100)
    const events: string[] = []
    const watcher = watch(sourcePath, event => events.push(event))
    try {
      const staging = join(fixture.root, ".binary-resource")
      const descriptor = {...fixture.descriptor, resourceFiles: [{sourcePath, targetPath: "resources/image.gif"}]}
      await createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})(buildInput(descriptor, staging, "binary-resource"))
      await Bun.sleep(100)
      expect(readFileSync(join(staging, "resources/image.gif")).equals(bytes)).toBeTrue()
      expect(readFileSync(sourcePath).equals(bytes)).toBeTrue()
      expect(events).toEqual([])
    } finally { watcher.close() }
  })

  test.each(["index.ts", "index.tsx"])("publishes TSDoc from %s without running it and rejects changed bytes", async entry => {
    const fixture = createFixture()
    const sourcePath = join(fixture.packageRoot, "module", entry)
    writeFileSync(sourcePath, '/** Module documentation */\nthrow new Error("Never execute")')
    const descriptor = {...fixture.descriptor, resourceFiles: [{sourcePath, sourceRoot: fixture.packageRoot,
      targetPath: "resources/module.md", contentDigest: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
      derivedContent: "# Module documentation"}]}
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    const staging = join(fixture.root, ".module-doc")
    await build(buildInput(descriptor, staging, "module-doc"))
    expect(readFileSync(join(staging, "resources/module.md"), "utf8")).toBe("# Module documentation")
    writeFileSync(sourcePath, "Changed source")
    await expect(build(buildInput(descriptor, join(fixture.root, ".changed-doc"), "changed-doc"))).rejects.toThrow("content changed after resolution")
  })

  test("canonicalizes an attested Bun hardlink mirror and rejects false same-name roots", () => {
    const root = mkdtempSync(join(tmpdir(), "storybook-owner-identity-"))
    roots.push(root)
    const ownerRoot = join(root, "owner")
    const mirrorRoot = join(root, "node_modules", ".bun", "owner-mirror", "node_modules", "@fixture", "owner")
    const tamperedRoot = join(root, "node_modules", ".bun", "owner-tampered", "node_modules", "@fixture", "owner")
    const foreignRoot = join(root, "foreign")
    for (const directory of [ownerRoot, mirrorRoot, tamperedRoot, foreignRoot]) mkdirSync(join(directory, "src"), {recursive: true})
    const metadata = join(ownerRoot, "package.json")
    const source = join(ownerRoot, "src/index.ts")
    writeFileSync(metadata, JSON.stringify({name: "@fixture/owner"}))
    writeFileSync(source, "export const owner = true\n")
    linkSync(metadata, join(mirrorRoot, "package.json"))
    linkSync(source, join(mirrorRoot, "src/index.ts"))
    linkSync(metadata, join(tamperedRoot, "package.json"))
    writeFileSync(join(tamperedRoot, "src/index.ts"), "export const owner = false\n")
    writeFileSync(join(foreignRoot, "package.json"), JSON.stringify({name: "@fixture/owner"}))
    writeFileSync(join(foreignRoot, "src/index.ts"), "export const foreign = true\n")
    expect(canonicalizeStorybookPackageIdentities([join(mirrorRoot, "src/index.ts"), source])).toEqual([join(realpathSync(ownerRoot), "src/index.ts")])
    expect(() => canonicalizeStorybookPackageIdentities([source, join(tamperedRoot, "src/index.ts")])).toThrow("file identity mismatch")
    expect(() => canonicalizeStorybookPackageIdentities([source, join(foreignRoot, "src/index.ts")])).toThrow("resolved to two realpaths")
  })

  test("emits a split revision payload without runtime or widget imports", async () => {
    const fixture = createFixture()
    const staging = join(fixture.root, ".candidate")
    const result = await createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})(buildInput(fixture.descriptor, staging, "revision-a"))
    expect(result.entryRelativePath).toMatch(/\.js$/u)
    expect(result.moduleGraphRevision).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.inputFingerprint.digest).toMatch(/^[a-f0-9]{64}$/u)
    const payload = readFileSync(join(staging, "revision-payload.js"), "utf8")
    expect(payload).toContain(`sharedModuleEpoch: "${isolatedStorybookSharedModuleEpoch(fixture.descriptor.packageId, "revision-a")}"`)
    expect(payload).toContain("STORYBOOK_PACKAGE_SCENARIO_LOADERS")
    expect(payload).not.toContain("loadRuntime")
    expect(payload).not.toContain("widgetLoaders")
  })

  test("includes a prepared component scenario and its fixture dependency closure", async () => {
    const fixture = createFixture()
    const scenarioPath = join(fixture.packageRoot, "module/spec/scenario.spec.tsx")
    const componentPath = join(fixture.packageRoot, "module/index.tsx")
    const fixturePath = join(fixture.packageRoot, "module/spec/fixture.tsx")
    mkdirSync(join(fixture.packageRoot, "module/spec"), {recursive: true})
    writeFileSync(componentPath, [
      "/** @jsxImportSource @zavx0z/template */",
      "export function Command(props: Readonly<{label: string}>) {",
      "  return <button>{props.label}</button>",
      "}", "",
    ].join("\n"))
    writeFileSync(fixturePath, [
      "/** @jsxImportSource @zavx0z/template */",
      'import {Command} from "../index"',
      "export function CommandFixture(props: Readonly<{label: string}>) {",
      "  return <Command label={props.label} />",
      "}", "",
    ].join("\n"))
    writeFileSync(join(fixture.packageRoot, "module/spec/host.ts"), [
      "export function createHost() {",
      "  return {render(_template: (props: Readonly<Record<string, unknown>>) => unknown, props: Readonly<Record<string, unknown>>) { return props }}",
      "}", "",
    ].join("\n"))
    writeFileSync(scenarioPath, [
      'import {describe, expect, test} from "bun:test"',
      'import {CommandFixture} from "./fixture"',
      'import {createHost} from "./host"',
      "const host = createHost()",
      'describe.each([{name: "Команда", props: {label: "Продолжить"}}])("$name", async ({props}) => {',
      "  const result = host.render(CommandFixture, props)",
      '  test("Представление", () => { expect(result).toBeDefined() })',
      "})", "",
    ].join("\n"))
    const nodeId = "directory:package:@fixture/package/module"
    const descriptor = {...fixture.descriptor, scenarioSpecs: [{nodeId, sourcePaths: [realpathSync(scenarioPath)]}]}
    const staging = join(fixture.root, ".scenario")
    const result = await createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})(buildInput(descriptor, staging, "scenario"))
    const prepared = await Bun.file(join(staging, "scenarios", `${encodeURIComponent(nodeId)}.json`)).json()
    expect(prepared.preview.variants.map((variant: {title: string}) => variant.title)).toEqual(["Команда"])
    expect(result.dependencyRealpaths).toContain(realpathSync(scenarioPath))
    expect(result.dependencyRealpaths).toContain(realpathSync(fixturePath))
  })

  test("rejects changed or symlinked Workbench stylesheet resources", async () => {
    const fixture = createFixture()
    const theme = join(fixture.packageRoot, "theme.css")
    writeFileSync(theme, ".theme { color: cyan; }\n")
    const contentDigest = createHash("sha256").update(readFileSync(theme)).digest("hex")
    const descriptor = {...fixture.descriptor, resourceFiles: [{sourcePath: theme, sourceRoot: fixture.packageRoot,
      targetPath: "workbench-author-style-sheets/0.css", contentDigest}],
      graphSnapshot: redigest({...fixture.descriptor.graphSnapshot, workbenchAuthorStyleSheets: [{
        specifier: "@fixture/package/theme.css", url: "workbench-author-style-sheets/0.css", contentDigest,
      }]})}
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    writeFileSync(theme, ".theme { color: changed; }\n")
    await expect(build(buildInput(descriptor, join(fixture.root, ".changed-css"), "changed-css"))).rejects.toThrow("content changed after resolution")
    const outside = join(fixture.root, "outside-theme.css")
    writeFileSync(outside, ".theme { color: cyan; }\n")
    unlinkSync(theme)
    symlinkSync(outside, theme)
    await expect(build(buildInput(descriptor, join(fixture.root, ".symlink-css"), "symlink-css"))).rejects.toThrow("exact non-symlink file")
  })

  test("reports build phases and exact worker lifecycle", async () => {
    const fixture = createFixture()
    const phases: string[] = []
    const workers: string[] = []
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await build({...buildInput(fixture.descriptor, join(fixture.root, ".events"), "events"),
      onPhase: ({phase, state}) => phases.push(`${phase}:${state}`),
      onWorkerLifecycle: ({state, workerId, pid}) => workers.push(`${state}:${workerId}:${pid}`)})
    expect(phases).toEqual(["fingerprint:started", "resources:started", "resources:completed",
      "exports:started", "exports:completed", "bundle:started", "bundle:completed", "fingerprint:completed"])
    expect(workers).toHaveLength(2)
    expect(workers[0]?.replace(/^started:/u, "")).toBe(workers[1]?.replace(/^exited:/u, ""))
  })

  test("times out and terminates a hung compile worker", async () => {
    const fixture = createFixture()
    const worker = join(fixture.root, "hung-worker.ts")
    writeFileSync(worker, "await new Promise(() => {})\n")
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry, workerPath: worker})
    await expect(build({...buildInput(fixture.descriptor, join(fixture.root, ".timeout"), "timeout"), compileTimeoutMs: 100})).rejects.toThrow("compile timed out")
  }, 3_000)

  test("abort terminates only the exact compile worker", async () => {
    const fixture = createFixture()
    const worker = join(fixture.root, "aborted-worker.ts")
    writeFileSync(worker, "await new Promise(() => {})\n")
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry, workerPath: worker})
    const controller = new AbortController()
    const pending = build({...buildInput(fixture.descriptor, join(fixture.root, ".aborted"), "aborted"),
      signal: controller.signal, compileTimeoutMs: 2_000})
    await Bun.sleep(40)
    controller.abort(new DOMException("package detached", "AbortError"))
    await expect(pending).rejects.toThrow("package detached")
  }, 3_000)
})

function createFixture(): Readonly<{root: string; packageRoot: string; browserEntry: string; descriptor: StorybookPackageBuildDescriptor}> {
  const root = mkdtempSync(join(tmpdir(), "storybook-package-build-"))
  roots.push(root)
  const packageRoot = join(root, "package")
  mkdirSync(join(packageRoot, "module"), {recursive: true})
  const sourcePath = join(packageRoot, "package.json")
  const browserEntry = join(root, "browser-entry.ts")
  const templateRoot = realpathSync(join(import.meta.dir, "../node_modules/@zavx0z/template"))
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/project", type: "module",
    devDependencies: {"@zavx0z/template": "link:@zavx0z/template"}}))
  mkdirSync(join(root, "node_modules", "@zavx0z"), {recursive: true})
  symlinkSync(templateRoot, join(root, "node_modules", "@zavx0z", "template"))
  writeFileSync(sourcePath, JSON.stringify({name: "@fixture/package", type: "module"}))
  writeFileSync(join(packageRoot, "module/index.ts"), "export const module = true\n")
  writeFileSync(browserEntry, ["export async function startExternalStorybookPackage(input: unknown) {",
    "  globalThis.__fixture = input", "}", "declare global { var __fixture: unknown }", ""].join("\n"))
  return Object.freeze({root, packageRoot, browserEntry, descriptor: {
    packageId: "@fixture/package", packageRoot, projectRoot: root, sourcePath,
    declarationDigest: "fixture-declaration", graphSnapshot: graphSnapshot("@fixture/package", "fixture-declaration"),
    resourceFiles: [], watchedPaths: [join(packageRoot, "module/index.ts")],
  }})
}

function buildInput(descriptor: StorybookPackageBuildDescriptor, stagingDirectory: string, revision: string) {
  return {descriptor, generation: 1, candidateRevision: revision,
    revisionUrl: `/__storybook/revisions/${encodeURIComponent(descriptor.packageId)}/${revision}/`,
    stagingDirectory, signal: new AbortController().signal, compileTimeoutMs: 30_000}
}

function graphSnapshot(packageId: string, declarationDigest: string): StorybookPackageRevisionGraphSnapshot {
  const packageNode = `package:${packageId}`
  const directoryNode = `directory:${packageNode}/module`
  const urlPath = `/packages/${encodeURIComponent(packageId)}/`
  const withoutDigest = {protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL, packageId, declarationDigest,
    metadata: {parentId: null, label: packageId, ownerId: packageId, urlPath}, ancestors: [], rootId: packageNode,
    nodes: [
      {id: packageNode, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [directoryNode], urlPath, routePath: "", searchTerms: [packageId],
        hasModuleDocumentation: false, resourceUrl: `resources/nodes/${encodeURIComponent(packageNode)}/`},
      {id: directoryNode, kind: "directory" as const, ownerId: packageId, packageId, label: "module",
        parentId: packageNode, childIds: [], urlPath: `${urlPath}module`, routePath: "dir-module", searchTerms: ["module"],
        hasModuleDocumentation: false, resourceUrl: `resources/nodes/${encodeURIComponent(directoryNode)}/`},
    ],
    routes: [{path: "", urlPath, kind: "overview" as const, nodeId: packageNode},
      {path: "dir-module", urlPath: `${urlPath}module`, kind: "overview" as const, nodeId: directoryNode}],
    resources: [], workbenchAuthorStyleSheets: []}
  return redigest({...withoutDigest, packageGraphDigest: ""})
}

function redigest(value: StorybookPackageRevisionGraphSnapshot): StorybookPackageRevisionGraphSnapshot {
  const {packageGraphDigest: _previous, ...withoutDigest} = value
  return {...withoutDigest, packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex")}
}
