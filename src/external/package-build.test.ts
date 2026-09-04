import {afterEach, describe, expect, setDefaultTimeout, test} from "bun:test"
import {createHash} from "node:crypto"
import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  canonicalizeStorybookPackageIdentities,
  createStorybookPackageRevisionBuilder,
} from "./package-build.ts"
import {STORYBOOK_PACKAGE_GRAPH_PROTOCOL, type StorybookPackageRevisionGraphSnapshot} from "./package-revision.ts"
import type {StorybookPackageBuildDescriptor} from "./package-session.ts"

const roots: string[] = []
setDefaultTimeout(20_000)

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("real Storybook package revision build", () => {
  test("canonicalizes an attested Bun hardlink mirror and rejects false same-name roots", () => {
    const root = mkdtempSync(join(tmpdir(), "storybook-owner-identity-"))
    roots.push(root)
    const ownerRoot = join(root, "owner")
    const mirrorRoot = join(root, "node_modules", ".bun", "owner-mirror", "node_modules", "@fixture", "owner")
    const tamperedRoot = join(root, "node_modules", ".bun", "owner-tampered", "node_modules", "@fixture", "owner")
    const foreignRoot = join(root, "foreign")
    for (const directory of [ownerRoot, mirrorRoot, tamperedRoot, foreignRoot]) {
      mkdirSync(join(directory, "src"), {recursive: true})
    }
    const manifest = join(ownerRoot, "package.json")
    const source = join(ownerRoot, "src", "index.ts")
    writeFileSync(manifest, JSON.stringify({name: "@fixture/owner"}))
    writeFileSync(source, "export const owner = true\n")
    linkSync(manifest, join(mirrorRoot, "package.json"))
    linkSync(source, join(mirrorRoot, "src", "index.ts"))
    linkSync(manifest, join(tamperedRoot, "package.json"))
    writeFileSync(join(tamperedRoot, "src", "index.ts"), "export const owner = false\n")
    writeFileSync(join(foreignRoot, "package.json"), JSON.stringify({name: "@fixture/owner"}))
    writeFileSync(join(foreignRoot, "src", "index.ts"), "export const foreign = true\n")

    expect(canonicalizeStorybookPackageIdentities([
      join(mirrorRoot, "src", "index.ts"),
      source,
    ])).toEqual([join(realpathSync(ownerRoot), "src", "index.ts")])
    expect(() => canonicalizeStorybookPackageIdentities([
      source,
      join(tamperedRoot, "src", "index.ts"),
    ])).toThrow("file identity mismatch")
    expect(() => canonicalizeStorybookPackageIdentities([
      source,
      join(foreignRoot, "src", "index.ts"),
    ])).toThrow("resolved to two realpaths")
  })

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
    expect(result.dependencyRealpaths).toContain(realpathSync(fixture.widget))
    expect(result.moduleGraphRevision).toMatch(/^[a-f0-9]{64}$/u)
    expect(await Bun.file(join(staging, "author-style-sheets/0.css")).text()).toBe(
      await Bun.file(fixture.theme).text(),
    )
    expect(await Bun.file(join(staging, result.entryRelativePath)).text()).not.toContain("fixture story marker")
    const chunks = await Array.fromAsync(new Bun.Glob("chunks/*.js").scan({cwd: staging, absolute: true}))
    expect(chunks.length).toBeGreaterThan(0)
    expect((await Promise.all(chunks.map((path) => Bun.file(path).text()))).join("\n"))
      .toContain("fixture story marker")
    expect((await Promise.all(chunks.map((path) => Bun.file(path).text()))).join("\n"))
      .toContain("fixture widget marker")
  })

  test("builds a declaration-only package from the shared Storybook compiler owner", async () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, "package.json"), JSON.stringify({
      name: "@fixture/project",
      type: "module",
    }))
    writeFileSync(join(fixture.root, "tsconfig.json"), JSON.stringify({
      compilerOptions: {jsxImportSource: "@zavx0z/template"},
    }))
    const descriptor: StorybookPackageBuildDescriptor = {
      ...fixture.descriptor,
      graphSnapshot: declarationOnlyGraphSnapshot(
        fixture.descriptor.packageId,
        fixture.descriptor.declarationDigest,
      ),
      resourceFiles: [],
      runtime: null,
      variants: [],
      widgetModules: [],
    }
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})

    const result = await build(buildInput(
      descriptor,
      join(fixture.root, ".candidate-declaration-only"),
      "revision-declaration-only",
    ))

    expect(result.entryRelativePath).toMatch(/\.js$/u)
    expect(result.moduleGraphRevision).toMatch(/^[a-f0-9]{64}$/u)
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

  test("includes component widget module bytes in the immutable module graph revision", async () => {
    const fixture = createFixture()
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    const first = await build(buildInput(
      fixture.descriptor,
      join(fixture.root, ".candidate-widget-a"),
      "revision-widget-a",
    ))
    writeFileSync(
      fixture.widget,
      readFileSync(fixture.widget, "utf8").replace("fixture widget marker", "changed widget marker"),
    )
    const second = await build(buildInput(
      fixture.descriptor,
      join(fixture.root, ".candidate-widget-b"),
      "revision-widget-b",
    ))
    expect(second.moduleGraphRevision).not.toBe(first.moduleGraphRevision)
  })

  test("fails before copying author CSS whose bytes no longer match the resolved digest", async () => {
    const fixture = createFixture()
    writeFileSync(fixture.theme, ".theme { color: changed; }\n")
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await expect(build(buildInput(
      fixture.descriptor,
      join(fixture.root, ".candidate-changed-css"),
      "revision-css",
    ))).rejects.toThrow("Revision resource content changed after resolution")
  })

  test("rejects an author CSS file replaced by a symlink even when bytes still match", async () => {
    const fixture = createFixture()
    const outside = join(fixture.root, "outside-theme.css")
    writeFileSync(outside, readFileSync(fixture.theme))
    unlinkSync(fixture.theme)
    symlinkSync(outside, fixture.theme)
    const build = createStorybookPackageRevisionBuilder({browserEntryPath: fixture.browserEntry})
    await expect(build(buildInput(
      fixture.descriptor,
      join(fixture.root, ".candidate-symlink-css"),
      "revision-symlink-css",
    ))).rejects.toThrow("exact non-symlink file")
  })

  test("fails protocol validation without losing build diagnostics", async () => {
    const fixture = createFixture()
    writeFileSync(fixture.runtime, "export const runtime = {protocol: 'storybook-runtime/1', create() {}}\n")
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
      "export const runtime = {protocol: 'storybook-runtime/4', create() {}}",
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
  widget: string
  theme: string
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
  const widget = join(packageRoot, ".storybook", "widget.tsx")
  const theme = join(packageRoot, "theme.css")
  const browserEntry = join(root, "browser-entry.ts")
  const templateRoot = realpathSync(join(import.meta.dir, "../../node_modules/@zavx0z/template"))
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@fixture/project",
    type: "module",
    devDependencies: {"@zavx0z/template": "link:@zavx0z/template"},
  }))
  mkdirSync(join(root, "node_modules", "@zavx0z"), {recursive: true})
  symlinkSync(templateRoot, join(root, "node_modules", "@zavx0z", "template"))
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({name: "@fixture/package", type: "module"}))
  writeFileSync(manifest, "{}\n")
  writeFileSync(runtime, [
    "export const runtime = {",
    "  protocol: 'storybook-runtime/4',",
    "  create() {",
    "    return {mount() {}, unmount() {}, dispose() {}}",
    "  },",
    "}",
    "",
  ].join("\n"))
  writeFileSync(story, "export const story = 'fixture story marker'\n")
  writeFileSync(widget, [
    "/** @jsxImportSource @zavx0z/template */",
    "export function widget(props: Readonly<{value: unknown}>) {",
    "  return <section>fixture widget marker {String(props.value ?? '')}</section>",
    "}",
    "",
  ].join("\n"))
  writeFileSync(theme, ".theme { color: cyan; }\n")
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
    widget,
    theme,
    browserEntry,
    descriptor: {
      packageId: "@fixture/package",
      packageRoot,
      projectRoot: root,
      manifestPath: manifest,
      declarationDigest: "fixture-declaration",
      graphSnapshot: graphSnapshot(
        "@fixture/package",
        "fixture-declaration",
        createHash("sha256").update(readFileSync(theme)).digest("hex"),
      ),
      resourceFiles: [{
        sourcePath: theme,
        sourceRoot: packageRoot,
        targetPath: "author-style-sheets/0.css",
        contentDigest: createHash("sha256").update(readFileSync(theme)).digest("hex"),
      }],
      runtime: {path: runtime, export: "runtime"},
      variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
      widgetModules: [{id: "fixture-widget", module: {path: widget, export: "widget"}}],
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
    compileTimeoutMs: 30_000,
    protocolTimeoutMs: 2_000,
  }
}

function graphSnapshot(
  packageId: string,
  declarationDigest: string,
  contentDigest: string,
): StorybookPackageRevisionGraphSnapshot {
  const packageNode = `package:${packageId}`
  const subjectNode = `subject:${packageId}/category/subject`
  const variantNode = `variant:${packageId}/category/subject/default`
  const presentation = {
    protocol: "story-presentation/1" as const,
    projection: "display" as const,
    widgets: ["source", "diagnostics", "fixture-widget"],
  }
  const withoutDigest = {
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest,
    metadata: {label: packageId, ownerId: packageId, urlPath: `/packages/${encodeURIComponent(packageId)}/`},
    ancestors: [],
    rootId: packageNode,
    nodes: [
      {
        id: packageNode, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [subjectNode], urlPath: `/packages/${encodeURIComponent(packageId)}/`, routePath: "",
        searchTerms: [packageId], group: null, subjectKind: null, apiName: null, hasReadme: false,
        resourceKinds: [], resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(packageNode)}/`,
        presentation: null,
      },
      {
        id: subjectNode, kind: "subject" as const, ownerId: packageId, packageId, label: "Subject",
        parentId: packageNode, childIds: [variantNode],
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/`, routePath: "category/subject",
        searchTerms: ["subject"], group: null, subjectKind: "fixture", apiName: null, hasReadme: false,
        resourceKinds: [], resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(subjectNode)}/`,
        presentation,
      },
      {
        id: variantNode, kind: "variant" as const, ownerId: packageId, packageId, label: "Default",
        parentId: subjectNode, childIds: [],
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        routePath: "category/subject/default", searchTerms: ["default"], group: null, subjectKind: null,
        apiName: null, hasReadme: false, resourceKinds: [],
        resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(variantNode)}/`,
        presentation,
      },
    ],
    routes: [
      {path: "", urlPath: `/packages/${encodeURIComponent(packageId)}/`, kind: "overview" as const, nodeId: packageNode},
      {
        path: "category/subject", urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/`,
        kind: "overview" as const, nodeId: subjectNode,
      },
      {
        path: "category/subject/default",
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        kind: "variant" as const,
        nodeId: variantNode,
      },
    ],
    loaders: [{route: "category/subject/default", nodeId: variantNode, exportName: "story"}],
    resources: [],
    authorStyleSheets: [{
      specifier: `${packageId}/theme.css`,
      url: "author-style-sheets/0.css",
      contentDigest,
    }],
    workbenchAuthorStyleSheets: [],
    widgetContributions: {
      protocol: "widget-contribution/1" as const,
      items: [{id: "fixture-widget", kind: "component" as const, label: "Fixture widget"}],
    },
    widgetLoaders: [{id: "fixture-widget", exportName: "widget"}],
  }
  return Object.freeze({
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  })
}

function declarationOnlyGraphSnapshot(
  packageId: string,
  declarationDigest: string,
): StorybookPackageRevisionGraphSnapshot {
  const packageNode = `package:${packageId}`
  const urlPath = `/packages/${encodeURIComponent(packageId)}/`
  const withoutDigest = {
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest,
    metadata: {label: packageId, ownerId: packageId, urlPath},
    ancestors: [],
    rootId: packageNode,
    nodes: [{
      id: packageNode,
      kind: "package" as const,
      ownerId: packageId,
      packageId,
      label: packageId,
      parentId: null,
      childIds: [],
      urlPath,
      routePath: "",
      searchTerms: [packageId],
      group: null,
      subjectKind: null,
      apiName: null,
      hasReadme: false,
      resourceKinds: [],
      resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(packageNode)}/`,
      presentation: null,
    }],
    routes: [{path: "", urlPath, kind: "overview" as const, nodeId: packageNode}],
    loaders: [],
    resources: [],
    authorStyleSheets: [],
    workbenchAuthorStyleSheets: [],
    widgetContributions: null,
    widgetLoaders: [],
  }
  return Object.freeze({
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  })
}
