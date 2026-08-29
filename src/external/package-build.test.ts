import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createStorybookPackageRevisionBuilder} from "./package-build.ts"
import {STORYBOOK_PACKAGE_GRAPH_PROTOCOL, type StorybookPackageRevisionGraphSnapshot} from "./package-revision.ts"
import type {StorybookPackageBuildDescriptor} from "./package-session.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("real Storybook package revision build", () => {
  test("emits a lazy split package entry and canonical dependency graph", async () => {
    const fixture = createFixture()
    const staging = join(fixture.root, ".candidate")
    const build = createStorybookPackageRevisionBuilder({
      browserEntryPath: fixture.browserEntry,
    })
    const result = await build(buildInput(fixture.descriptor, staging, "revision-a"))
    expect(result.entryRelativePath).toMatch(/\.js$/u)
    expect(result.dependencyRealpaths).toContain(realpathSync(fixture.runtime))
    expect(result.dependencyRealpaths).toContain(realpathSync(fixture.story))
    expect(result.moduleGraphRevision).toMatch(/^[a-f0-9]{64}$/u)
    expect(await Bun.file(join(staging, result.entryRelativePath)).text()).not.toContain("fixture story marker")
    const chunks = await Array.fromAsync(new Bun.Glob("chunks/*.js").scan({cwd: staging, absolute: true}))
    expect(chunks.length).toBeGreaterThan(0)
    expect((await Promise.all(chunks.map((path) => Bun.file(path).text()))).join("\n"))
      .toContain("fixture story marker")
  })

  test("fails before publish for a missing export", async () => {
    const fixture = createFixture()
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    const missing: StorybookPackageBuildDescriptor = {
      ...fixture.descriptor,
      variants: [{
        ...fixture.descriptor.variants[0]!,
        module: {path: fixture.story, export: "missing"},
      }],
    }
    await expect(build(buildInput(
      missing,
      join(fixture.root, ".candidate-missing"),
      "revision-b",
    ))).rejects.toThrow()
  })

  test("fails protocol validation without losing build diagnostics", async () => {
    const fixture = createFixture()
    writeFileSync(fixture.runtime, "export const runtime = {protocol: 'storybook-runtime/2', create() {}}\n")
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await expect(build(buildInput(
      fixture.descriptor,
      join(fixture.root, ".candidate-protocol"),
      "revision-c",
    ))).rejects.toThrow("Unsupported Storybook runtime protocol")
  })

  test("times out and terminates a hung runtime protocol child", async () => {
    const fixture = createFixture()
    writeFileSync(fixture.runtime, [
      "await new Promise(() => {})",
      "export const runtime = {protocol: 'storybook-runtime/1', create() {}}",
      "",
    ].join("\n"))
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await expect(build({
      ...buildInput(fixture.descriptor, join(fixture.root, ".candidate-timeout"), "revision-timeout"),
      compileTimeoutMs: 2_000,
      protocolTimeoutMs: 100,
    })).rejects.toThrow("timed out")
  }, 5_000)

  test("times out and terminates the exact hung compile worker", async () => {
    const fixture = createFixture()
    const worker = join(fixture.root, "hung-worker.ts")
    writeFileSync(worker, "await new Promise(() => {})\n")
    const build = createStorybookPackageRevisionBuilder({
      browserEntryPath: fixture.browserEntry,
      workerPath: worker,
    })
    await expect(build({
      ...buildInput(fixture.descriptor, join(fixture.root, ".candidate-compile-timeout"), "revision-hung"),
      compileTimeoutMs: 100,
    })).rejects.toThrow("compile timed out")
  }, 3_000)

  test("abort terminates only the exact compile worker", async () => {
    const fixture = createFixture()
    const worker = join(fixture.root, "aborted-worker.ts")
    writeFileSync(worker, "await new Promise(() => {})\n")
    const build = createStorybookPackageRevisionBuilder({
      browserEntryPath: fixture.browserEntry,
      workerPath: worker,
    })
    const controller = new AbortController()
    const pending = build({
      ...buildInput(fixture.descriptor, join(fixture.root, ".candidate-aborted"), "revision-aborted"),
      signal: controller.signal,
      compileTimeoutMs: 2_000,
    })
    await Bun.sleep(40)
    controller.abort(new DOMException("package detached", "AbortError"))
    await expect(pending).rejects.toThrow("package detached")
  }, 3_000)
})

function createFixture(): Readonly<{
  root: string
  runtime: string
  story: string
  browserEntry: string
  descriptor: StorybookPackageBuildDescriptor
}> {
  const root = mkdtempSync(join(tmpdir(), "storybook-package-build-"))
  roots.push(root)
  const packageRoot = join(root, "package")
  mkdirSync(join(packageRoot, ".storybook"), {recursive: true})
  const manifest = join(packageRoot, ".storybook", "manifest.json")
  const runtime = join(packageRoot, ".storybook", "runtime.ts")
  const story = join(packageRoot, ".storybook", "story.ts")
  const browserEntry = join(root, "browser-entry.ts")
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({name: "@fixture/package", type: "module"}))
  writeFileSync(manifest, "{}\n")
  writeFileSync(runtime, [
    "export const runtime = {",
    "  protocol: 'storybook-runtime/1',",
    "  create() {",
    "    return {mount() {}, unmount() {}, dispose() {}}",
    "  },",
    "}",
    "",
  ].join("\n"))
  writeFileSync(story, "export const story = 'fixture story marker'\n")
  writeFileSync(browserEntry, [
    "export async function startExternalStorybookPackage(input: unknown) {",
    "  globalThis.__fixture = input",
    "}",
    "declare global { var __fixture: unknown }",
    "",
  ].join("\n"))
  return Object.freeze({
    root,
    runtime,
    story,
    browserEntry,
    descriptor: {
      packageId: "@fixture/package",
      packageRoot,
      projectRoot: root,
      manifestPath: manifest,
      declarationDigest: "fixture-declaration",
      graphSnapshot: graphSnapshot("@fixture/package", "fixture-declaration"),
      runtime: {path: runtime, export: "runtime"},
      variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
    },
  })
}

function buildInput(
  descriptor: StorybookPackageBuildDescriptor,
  stagingDirectory: string,
  revision: string,
) {
  return {
    descriptor,
    generation: 1,
    candidateRevision: revision,
    revisionUrl: `/__storybook/revisions/${encodeURIComponent(descriptor.packageId)}/${revision}/`,
    stagingDirectory,
    signal: new AbortController().signal,
    compileTimeoutMs: 10_000,
    protocolTimeoutMs: 2_000,
  }
}

function graphSnapshot(packageId: string, declarationDigest: string): StorybookPackageRevisionGraphSnapshot {
  const packageNode = `package:${packageId}`
  const variantNode = `variant:${packageId}/category/subject/default`
  const withoutDigest = {
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest,
    metadata: {label: packageId, ownerId: packageId, urlPath: `/packages/${encodeURIComponent(packageId)}/`},
    rootId: packageNode,
    nodes: [
      {
        id: packageNode, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [], urlPath: `/packages/${encodeURIComponent(packageId)}/`, routePath: "",
        searchTerms: [packageId], group: null, subjectKind: null, apiName: null, hasReadme: false,
        resourceKinds: [], resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(packageNode)}/`,
      },
      {
        id: variantNode, kind: "variant" as const, ownerId: packageId, packageId, label: "Default",
        parentId: packageNode, childIds: [],
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        routePath: "category/subject/default", searchTerms: ["default"], group: null, subjectKind: null,
        apiName: null, hasReadme: false, resourceKinds: [],
        resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(variantNode)}/`,
      },
    ],
    routes: [
      {path: "", urlPath: `/packages/${encodeURIComponent(packageId)}/`, kind: "overview" as const, nodeId: packageNode},
      {
        path: "category/subject/default",
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        kind: "variant" as const,
        nodeId: variantNode,
      },
    ],
    loaders: [{route: "category/subject/default", nodeId: variantNode, exportName: "story"}],
    resources: [],
  }
  return Object.freeze({
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  })
}
