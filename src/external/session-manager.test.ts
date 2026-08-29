import {afterEach, describe, expect, spyOn, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {ExternalStorybookSessionManager} from "./session-manager.ts"
import {StorybookDependencyWatchCoordinator} from "./dependency-watch.ts"
import {STORYBOOK_PACKAGE_GRAPH_PROTOCOL, type StorybookPackageRevisionGraphSnapshot} from "./package-revision.ts"
import type {
  StorybookPackageBuildDescriptor,
  StorybookPackageEvent,
  StorybookPackageRevisionBuilder,
} from "./package-session.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook PackageSession manager", () => {
  test("sync adds, preserves, reconfigures and detaches exact sessions", async () => {
    const root = fixtureRoot()
    const events: StorybookPackageEvent[] = []
    const manager = new ExternalStorybookSessionManager({
      artifactRoot: join(root, ".artifacts"),
      buildRevision: successfulBuilder(),
      publish: (event) => events.push(event),
      rebuildDelayMs: 0,
    })
    const a = descriptor(root, "a")
    const b = descriptor(root, "b")
    manager.sync([a, b])
    const aSession = manager.session("@fixture/a")
    await manager.ensure("@fixture/a")
    manager.sync([descriptor(root, "a", "a-next")])
    expect(manager.session("@fixture/a")).toBe(aSession)
    await Bun.sleep(15)
    expect(manager.snapshots()).toHaveLength(1)
    expect(manager.snapshots()[0]?.declarationDigest).toBe("a-next")
    expect(events.some(({type, packageId}) =>
      type === "package.detached" && packageId === "@fixture/b")).toBeTrue()
    await manager.dispose()
  })

  test("shared dependency invalidates A and B but not C", async () => {
    const root = fixtureRoot()
    const shared = join(root, "shared.ts")
    writeFileSync(shared, "export const shared = true\n")
    const builder: StorybookPackageRevisionBuilder = async ({stagingDirectory}) => {
      mkdirSync(stagingDirectory, {recursive: true})
      writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
      return {moduleGraphRevision: "graph", dependencyRealpaths: [shared], entryRelativePath: "entry.js"}
    }
    const manager = new ExternalStorybookSessionManager({
      artifactRoot: join(root, ".artifacts"),
      buildRevision: builder,
      rebuildDelayMs: 0,
    })
    manager.sync([descriptor(root, "a"), descriptor(root, "b"), descriptor(root, "c")])
    await Promise.all([manager.ensure("@fixture/a"), manager.ensure("@fixture/b")])
    expect(manager.notifyDependency(shared)).toBe(2)
    await Bun.sleep(15)
    expect(manager.session("@fixture/a").snapshot().builds).toBe(2)
    expect(manager.session("@fixture/b").snapshot().builds).toBe(2)
    expect(manager.session("@fixture/c").snapshot().builds).toBe(0)
    await manager.dispose()
  })

  test("hung A does not block B through the shared bounded semaphore", async () => {
    const root = fixtureRoot()
    let aStarted!: () => void
    const started = new Promise<void>((resolvePromise) => { aStarted = resolvePromise })
    const builder: StorybookPackageRevisionBuilder = async (input) => {
      if (input.descriptor.packageId === "@fixture/a") {
        aStarted()
        await new Promise<void>((_resolve, reject) => input.signal.addEventListener("abort", () => {
          reject(input.signal.reason)
        }, {once: true}))
      }
      return successfulBuild(input.stagingDirectory)
    }
    const manager = new ExternalStorybookSessionManager({
      artifactRoot: join(root, ".artifacts"),
      buildRevision: builder,
      buildConcurrency: 2,
    })
    manager.sync([descriptor(root, "a"), descriptor(root, "b")])
    const a = manager.ensure("@fixture/a")
    await started
    const b = await manager.ensure("@fixture/b")
    expect(b.buildState).toBe("built")
    expect(manager.session("@fixture/a").snapshot().buildState).toBe("building")
    await manager.dispose()
    await a
  })

  test("publishes a committed revision even when watcher projection fails", async () => {
    const root = fixtureRoot()
    let failWatch = false
    const watch = {
      replace() {
        if (failWatch) throw new Error("watch failed")
        return Object.freeze([])
      },
      remove() { return true },
      notify() { return 0 },
      dispose() {},
    } as unknown as StorybookDependencyWatchCoordinator
    const events: StorybookPackageEvent[] = []
    const errors = spyOn(console, "error").mockImplementation(() => {})
    const manager = new ExternalStorybookSessionManager({
      artifactRoot: join(root, ".artifacts"),
      buildRevision: successfulBuilder(),
      publish: (event) => events.push(event),
      watch,
    })
    manager.sync([descriptor(root, "watch")])
    await manager.ensure("@fixture/watch")
    failWatch = true
    const session = manager.session("@fixture/watch")
    expect(session.invalidate(session.descriptor.variants[0]!.module.path)).toBeTrue()
    const result = await session.ensureBuilt()
    expect(result.buildState).toBe("built")
    expect(result.activeRevision).toBeNull()
    expect(result.lastWorkingRevision).toBeNull()
    expect(events.at(-1)?.type).toBe("package.built")
    expect(errors).toHaveBeenCalled()
    await manager.dispose()
    errors.mockRestore()
  })

  test("routes the full categorized package watcher matrix and ignores unrelated files", async () => {
    const root = fixtureRoot()
    const files = Object.fromEntries([
      "catalog.json",
      "package.json",
      "README.md",
      "fixture.json",
      "reference.json",
      "media.png",
      "evidence.json",
      "asset.svg",
      "shared.ts",
      "unrelated.txt",
    ].map((name) => {
      const path = join(root, name)
      writeFileSync(path, `${name}\n`)
      return [name, path]
    }))
    const events: StorybookPackageEvent[] = []
    const value = descriptor(root, "matrix", "matrix", [
      {path: files["catalog.json"]!, category: "declaration"},
      {path: files["package.json"]!, category: "metadata"},
      {path: files["package.json"]!, category: "code"},
      {path: files["README.md"]!, category: "metadata"},
      ...["fixture.json", "reference.json", "media.png", "evidence.json", "asset.svg"]
        .map((name) => ({path: files[name]!, category: "resource" as const})),
      {path: files["shared.ts"]!, category: "code"},
    ])
    const manager = new ExternalStorybookSessionManager({
      artifactRoot: join(root, ".artifacts"),
      buildRevision: successfulBuilder(),
      publish: (event) => events.push(event),
      rebuildDelayMs: 0,
    })
    manager.sync([value])
    await manager.ensure("@fixture/matrix")
    const emitted = (path: string): string[] => {
      events.length = 0
      expect(manager.notifyDependency(path)).toBe(1)
      return events.map(({type}) => type)
    }
    expect(emitted(files["catalog.json"]!)).toEqual([])
    expect(emitted(files["package.json"]!)).toEqual([
      "package.metadata-updated",
      "package.code-updated",
    ])
    expect(emitted(files["README.md"]!)).toEqual(["package.metadata-updated"])
    for (const name of ["fixture.json", "reference.json", "media.png", "evidence.json", "asset.svg"]) {
      expect(emitted(files[name]!)).toEqual(["package.resources-updated"])
    }
    expect(emitted(files["shared.ts"]!)).toEqual(["package.code-updated"])
    expect(manager.notifyDependency(files["unrelated.txt"]!)).toBe(0)
    await manager.dispose()
  })
})

function descriptor(
  root: string,
  id: string,
  declarationDigest = id,
  watchPaths: StorybookPackageBuildDescriptor["watchPaths"] = Object.freeze([]),
): StorybookPackageBuildDescriptor {
  const packageRoot = join(root, id)
  mkdirSync(packageRoot, {recursive: true})
  const manifest = join(packageRoot, "manifest.json")
  const runtime = join(packageRoot, "runtime.ts")
  const story = join(packageRoot, "story.ts")
  writeFileSync(manifest, "{}\n")
  writeFileSync(runtime, "export const runtime = {}\n")
  writeFileSync(story, "export const story = {}\n")
  return {
    packageId: `@fixture/${id}`,
    packageRoot,
    projectRoot: root,
    manifestPath: manifest,
    declarationDigest,
    watchPaths,
    graphSnapshot: graphSnapshot(`@fixture/${id}`, declarationDigest),
    runtime: {path: runtime, export: "runtime"},
    variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
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

function successfulBuilder(): StorybookPackageRevisionBuilder {
  return async ({stagingDirectory}) => successfulBuild(stagingDirectory)
}

function successfulBuild(stagingDirectory: string) {
  mkdirSync(stagingDirectory, {recursive: true})
  writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
  return {moduleGraphRevision: "graph", dependencyRealpaths: [], entryRelativePath: "entry.js"}
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-session-manager-"))
  roots.push(root)
  return root
}
