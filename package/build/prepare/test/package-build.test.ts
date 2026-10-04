import PackageRevisionOwner, {type StorybookPackageRevision as PackageRevisionContract} from "@zavx0z/storybook-package-revision"
import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
const STORYBOOK_PACKAGE_GRAPH_PROTOCOL = PackageRevisionOwner.protocol
type StorybookPackageRevisionGraphSnapshot = ReturnType<PackageRevisionContract.Output["create"]>
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
import {afterEach, describe, expect, setDefaultTimeout, test} from "bun:test"
import {createHash} from "node:crypto"
import {linkSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, unlinkSync, watch, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createStorybookPackageRevisionBuilder from "../index.ts"
import inputs from "@zavx0z/storybook-package-build-inputs"
import prepareStorybookScenarios from "@zavx0z/storybook-package-build-scenarios"
import {isolatedStorybookSharedModuleEpoch} from "../src/in-process"

const canonicalizeStorybookPackageIdentities = inputs.canonicalizeIdentities
import Scheduler from "@zavx0z/storybook-package-build-scheduler"
const STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL = Scheduler.STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL

const toolRoot = realpathSync(join(import.meta.dir, "../../../.."))
const roots: string[] = []
setDefaultTimeout(60_000)
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })

describe("structural package revision build", () => {
  test("пакетный adapter сохраняет диагностику и терпимый stdout после завершения worker", async () => {
    const fixture = createFixture()
    const workerPath = join(fixture.root, "diagnostic-worker.ts")
    const staging = join(fixture.root, ".diagnostic")
    writeFileSync(workerPath, [
      'import {writeFileSync} from "node:fs"',
      'const [, resultPath, workerId] = process.argv.slice(2)',
      'console.log("unrelated stdout")',
      `console.log(JSON.stringify({protocol: ${JSON.stringify(STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL)}, kind: "ready", workerId, pid: process.pid}))`,
      `console.log(JSON.stringify({protocol: ${JSON.stringify(STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL)}, kind: "phase", event: {phase: "bundle", state: "started", at: new Date().toISOString()}}))`,
      'writeFileSync(resultPath, JSON.stringify({ok: false, message: "fallback", diagnostics: [{phase: "validate", message: "owned package diagnostic", path: null}]}))',
      'process.exitCode = 1',
    ].join("\n"))
    const lifecycle: string[] = []
    const phases: string[] = []
    const build = createStorybookPackageRevisionBuilder({
      toolRoot,
      browserEntryPath: fixture.browserEntry,
      workerPath,
      onPhase: event => phases.push(event.phase),
      onWorkerLifecycle: event => lifecycle.push(event.state),
    })
    await expect(build(buildInput(fixture.descriptor, staging, "diagnostic"))).rejects.toThrow("owned package diagnostic")
    expect(lifecycle).toEqual(["started", "exited"])
    expect(phases).toEqual(["bundle"])
    expect(readdirSync(staging)).toEqual([])
  })

  test("запускает worker выбранного toolRoot без подмены текущим модулем сборщика", async () => {
    const fixture = createFixture()
    const selectedTool = join(fixture.root, "selected-tool")
    mkdirSync(join(selectedTool, "package/build/prepare/src"), {recursive: true})
    mkdirSync(join(selectedTool, "runtime"))
    writeFileSync(join(selectedTool, "runtime/package-entry.ts"), "export {}\n")
    writeFileSync(join(selectedTool, "package/build/prepare/src/package-build-worker.ts"),
      'process.stderr.write("selected tool owner worker")\nprocess.exit(1)\n')
    const build = createStorybookPackageRevisionBuilder({
      toolRoot: selectedTool,
      browserEntryPath: join(selectedTool, "runtime/package-entry.ts"),
    })
    await expect(build(buildInput(fixture.descriptor, join(fixture.root, ".selected-worker"), "selected-worker")))
      .rejects.toThrow("selected tool owner worker")
  })

  test("упавшая проверка сценария останавливает работу до компиляции", async () => {
    const fixture = createFixture()
    writeFileSync(fixture.descriptor.sourcePath, JSON.stringify({name: "@fixture/package", type: "module", exports: {"./module": "./module/index.ts"}}))
    const directory = join(fixture.packageRoot, "module/spec")
    mkdirSync(directory)
    writeFileSync(join(fixture.packageRoot, "module/index.ts"), "export function evaluate(props: {value: number}) { return props.value }\n")
    const path = join(directory, "scenario.spec.ts")
    writeFileSync(path, [
      'import {describe, expect, test} from "bun:test"',
      'import {evaluate} from "@fixture/package/module"',
      'describe.each([{name: "Ошибка", props: {value: 1}}])("$name", ({props}) => {',
      '  const result = evaluate(props)',
      '  test("Результат", () => { expect(result, "Проверка до компиляции").toBe(2) })',
      '})',
    ].join("\n"))
    let compilerEntered = false
    const build = createStorybookPackageRevisionBuilder({
      toolRoot,
      browserEntryPath: fixture.browserEntry,
      resolveCompilerPlugins: async () => {
        compilerEntered = true
        return []
      },
    })
    const descriptor = {...fixture.descriptor, scenarioSpecs: [{nodeId: "scenario", sourcePaths: [path]}]}
    await expect(build(buildInput(descriptor, join(fixture.root, ".failed-check"), "failed-check"))).rejects.toThrow("Проверка до компиляции")
    expect(compilerEntered, "Компилятор запускается после успешных проверок").toBeFalse()
  })

  test("распознанный сценарий с непредставимым аргументом не исчезает молча", async () => {
    const root = mkdtempSync(join(tmpdir(), "storybook-unrepresentable-"))
    roots.push(root)
    mkdirSync(join(root, "spec"))
    writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/unrepresentable", type: "module", exports: {".": "./index.ts"}}))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ESNext", module: "ESNext", moduleResolution: "Bundler", noEmit: true}}))
    writeFileSync(join(root, "index.ts"), 'export function inspect(input: {value: () => number}) { return input.value() }\n')
    const path = join(root, "spec/scenario.spec.ts")
    writeFileSync(path, [
      'import {describe, expect, test} from "bun:test"',
      'import {inspect} from "@fixture/unrepresentable"',
      'describe.each([{name: "Колбэк", props: {value: () => 1}}])("$name", ({props}) => {',
      '  const result = inspect(props)',
      '  test("Результат", () => { expect(result, "Функция выполнена").toBe(1) })',
      '})',
    ].join("\n"))
    const descriptor = {scenarioSpecs: [{nodeId: "scenario", sourcePaths: [path]}]} as unknown as StorybookPackageBuildDescriptor
    let failure: unknown
    try { await prepareStorybookScenarios(descriptor, new AbortController().signal) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("Не удалось подготовить представление распознанного сценария")
    expect((failure as Error).message).toContain(path)
  })
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
      await createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry})(buildInput(descriptor, staging, "binary-resource"))
      await Bun.sleep(100)
      expect(readFileSync(join(staging, "resources/image.gif")).equals(bytes)).toBeTrue()
      expect(readFileSync(sourcePath).equals(bytes)).toBeTrue()
      expect(events).toEqual([])
    } finally { watcher.close() }
  })

  test.each(["index.ts", "index.tsx"])("publishes TSDoc from %s without running it or revalidating current source bytes", async entry => {
    const fixture = createFixture()
    const sourcePath = join(fixture.packageRoot, "module", entry)
    writeFileSync(sourcePath, '/** Module documentation */\nthrow new Error("Never execute")')
    const descriptor = {...fixture.descriptor, resourceFiles: [{sourcePath, sourceRoot: fixture.packageRoot,
      targetPath: "resources/module.md", contentDigest: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
      derivedContent: "# Module documentation"}]}
    const build = createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry})
    const staging = join(fixture.root, ".module-doc")
    await build(buildInput(descriptor, staging, "module-doc"))
    expect(readFileSync(join(staging, "resources/module.md"), "utf8")).toBe("# Module documentation")
    writeFileSync(sourcePath, "Changed source")
    const changedStaging = join(fixture.root, ".changed-doc")
    await build(buildInput(descriptor, changedStaging, "changed-doc"))
    expect(readFileSync(join(changedStaging, "resources/module.md"), "utf8")).toBe("# Module documentation")
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
    const result = await createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry})(buildInput(fixture.descriptor, staging, "revision-a"))
    expect(result.entryRelativePath).toMatch(/\.js$/u)
    expect(result.moduleGraphRevision).toMatch(/^[a-f0-9]{64}$/u)
    const payload = readFileSync(join(staging, "revision-payload.js"), "utf8")
    expect(payload).toContain(`sharedModuleEpoch: "${isolatedStorybookSharedModuleEpoch(fixture.descriptor.packageId, "revision-a")}"`)
    expect(payload).toContain("STORYBOOK_PACKAGE_SCENARIO_LOADERS")
    expect(payload).not.toContain("loadRuntime")
    expect(payload).not.toContain("widgetLoaders")
  })

  test("includes inline JSX and its component dependency closure", async () => {
    const fixture = createFixture()
    const scenarioPath = join(fixture.packageRoot, "module/spec/scenario.spec.tsx")
    const componentPath = join(fixture.packageRoot, "module/index.tsx")
    unlinkSync(join(fixture.packageRoot, "module/index.ts"))
    mkdirSync(join(fixture.packageRoot, "module/spec"), {recursive: true})
    writeFileSync(componentPath, [
      "/** @jsxImportSource @zavx0z/immersive-jsx */",
      "export function Command(props: Readonly<{label: string; onActivate?: (label: string) => void}>) {",
      "  return <button onClick={() => props.onActivate?.(props.label)}>{props.label}</button>",
      "}", "",
    ].join("\n"))
    writeFileSync(join(fixture.packageRoot, "module/spec/host.ts"), [
      "export function createHost() {",
      "  return {render(value: unknown) { return value }}",
      "}", "",
    ].join("\n"))
    writeFileSync(join(fixture.packageRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: {jsx: "preserve", jsxImportSource: "@zavx0z/immersive-jsx", module: "ESNext", moduleResolution: "Bundler", target: "ESNext"},
      include: ["**/*.ts", "**/*.tsx"],
    }))
    mkdirSync(join(fixture.root, "node_modules", "@immersive"), {recursive: true})
    symlinkSync(realpathSync(join(import.meta.dir, "../../../../node_modules/@zavx0z/immersive-headless")), join(fixture.root, "node_modules", "@zavx0z/immersive-headless"))
    writeFileSync(join(fixture.packageRoot, "preload.ts"), [
      'import {afterAll} from "bun:test"',
      'import {createHeadless} from "@zavx0z/immersive-headless"',
      `const host = createHeadless({projectRoot: ${JSON.stringify(fixture.packageRoot)}})`,
      'afterAll(() => host.dispose())',
    ].join("\n"))
    writeFileSync(join(fixture.packageRoot, "package.json"), JSON.stringify({
      name: "@fixture/package", type: "module", scripts: {test: "bun test --preload ./preload.ts --preload @zavx0z/immersive-headless"},
    }))
    writeFileSync(scenarioPath, [
      'import {describe, expect, mock, test} from "bun:test"',
      'import {Command} from "../index"',
      'import {createHost} from "./host"',
      "const host = createHost()",
      'describe.each([{name: "Команда", props: {label: "Продолжить"}}])("$name", async ({props: input}) => {',
      "  const props = {...input, onActivate: mock()}",
      "  const result = host.render(<Command label={props.label} onActivate={props.onActivate} />)",
      '  test("Представление", () => { expect(result, "Компонент создаёт представление").toBeDefined() })',
      "})", "",
    ].join("\n"))
    const nodeId = "directory:package:@fixture/package/module"
    const descriptor = {...fixture.descriptor, scenarioSpecs: [{nodeId, sourcePaths: [realpathSync(scenarioPath)]}]}
    const staging = join(fixture.root, ".scenario")
    const result = await createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry})(buildInput(descriptor, staging, "scenario"))
    const prepared = await Bun.file(join(staging, "scenarios", `${encodeURIComponent(nodeId)}.json`)).json()
    expect(prepared.preview.variants.map((variant: {title: string}) => variant.title)).toEqual(["Команда"])
    expect(result.dependencyRealpaths).toContain(realpathSync(scenarioPath))
    expect(result.dependencyRealpaths).toContain(realpathSync(componentPath))
    expect(prepared.preview.variants[0].source).toContain("mock()")
    expect(prepared.preview.module.source).toContain("() => undefined")
    expect(prepared.preview.module.source).not.toContain("bun:test")
  })

  test("publishes captured stylesheet bytes and rejects symlinked raw resources", async () => {
    const fixture = createFixture()
    const theme = join(fixture.packageRoot, "theme.css")
    writeFileSync(theme, ".theme { color: cyan; }\n")
    const contentDigest = createHash("sha256").update(readFileSync(theme)).digest("hex")
    const descriptor = {...fixture.descriptor, resourceFiles: [{sourcePath: theme, sourceRoot: fixture.packageRoot,
      targetPath: "workbench-author-style-sheets/0.css", contentDigest, derivedContent: ".theme { color: cyan; }\n"}],
      graphSnapshot: redigest({...fixture.descriptor.graphSnapshot, workbenchAuthorStyleSheets: [{
        specifier: "@fixture/package/theme.css", url: "workbench-author-style-sheets/0.css", contentDigest,
      }]})}
    const build = createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry})
    writeFileSync(theme, ".theme { color: changed; }\n")
    const changed = join(fixture.root, ".changed-css")
    await build(buildInput(descriptor, changed, "changed-css"))
    expect(readFileSync(join(changed, "workbench-author-style-sheets/0.css"), "utf8")).toBe(".theme { color: cyan; }\n")
    const outside = join(fixture.root, "outside-theme.css")
    writeFileSync(outside, ".theme { color: cyan; }\n")
    unlinkSync(theme)
    symlinkSync(outside, theme)
    await expect(build(buildInput({...fixture.descriptor, resourceFiles: [{sourcePath: theme, sourceRoot: fixture.packageRoot, targetPath: "resources/theme.css"}]}, join(fixture.root, ".symlink-css"), "symlink-css"))).rejects.toThrow("exact non-symlink file")
  })

  test("reports build phases and exact worker lifecycle", async () => {
    const fixture = createFixture()
    const phases: string[] = []
    const workers: string[] = []
    const build = createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry})
    await build({...buildInput(fixture.descriptor, join(fixture.root, ".events"), "events"),
      onPhase: ({phase, state}) => phases.push(`${phase}:${state}`),
      onWorkerLifecycle: ({state, workerId, pid}) => workers.push(`${state}:${workerId}:${pid}`)})
    expect(phases).toEqual(["verification:started", "verification:completed", "resources:started", "resources:completed",
      "exports:started", "exports:completed", "bundle:started", "bundle:completed"])
    expect(workers).toHaveLength(2)
    expect(workers[0]?.replace(/^started:/u, "")).toBe(workers[1]?.replace(/^exited:/u, ""))
  })

  test("abort terminates only the exact compile worker", async () => {
    const fixture = createFixture()
    const worker = join(fixture.root, "aborted-worker.ts")
    writeFileSync(worker, "await new Promise(() => {})\n")
    const build = createStorybookPackageRevisionBuilder({toolRoot, browserEntryPath: fixture.browserEntry, workerPath: worker})
    const controller = new AbortController()
    const pending = build({...buildInput(fixture.descriptor, join(fixture.root, ".aborted"), "aborted"),
      signal: controller.signal})
    await Bun.sleep(40)
    controller.abort(new DOMException("package detached", "AbortError"))
    await expect(pending).rejects.toThrow("package detached")
  }, 3_000)
})

test("успешная компиляция сохраняет результат при изменении документа внутри owner", async () => {
  const fixture = createFixture()
  const note = join(fixture.packageRoot, "README.md")
  writeFileSync(note, "До компиляции")
  let changed = false
  const build = createStorybookPackageRevisionBuilder({
    toolRoot,
    browserEntryPath: fixture.browserEntry,
    resolveCompilerPlugins: async () => [{
      name: "edit-owner-document",
      setup(builder) {
        builder.onStart(() => {
          writeFileSync(note, "Правка во время успешной компиляции")
          changed = true
        })
      },
    }],
  })
  const staging = join(fixture.root, ".changed-during-build")
  const result = await build(buildInput(fixture.descriptor, staging, "changed-during-build"))
  expect(changed, "Документ изменён настоящим compiler hook").toBeTrue()
  expect(readFileSync(join(staging, result.entryRelativePath), "utf8"), "Успешный Bun output сохраняется").toContain("startExternalStorybookPackage")
  expect(readFileSync(note, "utf8")).toBe("Правка во время успешной компиляции")
})

function createFixture(): Readonly<{root: string; packageRoot: string; browserEntry: string; descriptor: StorybookPackageBuildDescriptor}> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-package-build-")))
  roots.push(root)
  const packageRoot = join(root, "package")
  mkdirSync(join(packageRoot, "module"), {recursive: true})
  const sourcePath = join(packageRoot, "package.json")
  const browserEntry = join(root, "browser-entry.ts")
  const jsxRoot = realpathSync(join(import.meta.dir, "../../../../node_modules/@zavx0z/immersive-jsx"))
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/repo", type: "module",
    devDependencies: {"@zavx0z/immersive-jsx": "link:@zavx0z/immersive-jsx"}}))
  mkdirSync(join(root, "node_modules", "@zavx0z"), {recursive: true})
  symlinkSync(jsxRoot, join(root, "node_modules", "@zavx0z", "jsx"))
  symlinkSync(realpathSync(join(import.meta.dir, "../../../../node_modules/@zavx0z/immersive-template")), join(root, "node_modules", "@zavx0z", "template"))
  writeFileSync(sourcePath, JSON.stringify({name: "@fixture/package", type: "module"}))
  writeFileSync(join(packageRoot, "module/index.ts"), "export const module = true\n")
  writeFileSync(browserEntry, ["export default async function startExternalStorybookPackage(input: unknown) {",
    "  globalThis.__fixture = input", "}", "declare global { var __fixture: unknown }", ""].join("\n"))
  return Object.freeze({root, packageRoot, browserEntry, descriptor: {
    packageId: "@fixture/package", packageRoot, repo: root, sourcePath,
    declarationDigest: "fixture-declaration", graphSnapshot: graphSnapshot("@fixture/package", "fixture-declaration"),
    resourceFiles: [],
  }})
}

function buildInput(descriptor: StorybookPackageBuildDescriptor, stagingDirectory: string, revision: string) {
  return {descriptor, generation: 1, candidateRevision: revision,
    revisionUrl: `/__storybook/revisions/${encodeURIComponent(descriptor.packageId)}/${revision}/`,
    stagingDirectory, signal: new AbortController().signal}
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
