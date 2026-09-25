import {afterEach, describe, expect, spyOn, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  ExternalStorybookSessionManager,
  storybookSessionAdditionalInputWatchPaths,
} from "./session-manager.ts"
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
  test("registry-owned declaration не возвращается как code input watcher", () => {
    const root = fixtureRoot()
    const contract = join(root, "contract", "input.ts")
    const code = join(root, "runtime.ts")
    const resource = join(root, "asset.svg")
    mkdirSync(join(root, "contract"), {recursive: true})
    writeFileSync(contract, "/** Contract */\nexport interface Input {}\n")
    writeFileSync(code, "export const runtime = true\n")
    writeFileSync(resource, "<svg/>\n")

    expect(storybookSessionAdditionalInputWatchPaths([
      {path: contract, category: "declaration"},
      {path: code, category: "code"},
      {path: resource, category: "resource"},
    ], [contract, code, resource])).toEqual([code, resource])
  })

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
    expect(manager.snapshots()[0]?.builds).toBe(1)
    expect(events.some(({type, packageId}) =>
      type === "package.detached" && packageId === "@fixture/b")).toBeTrue()
    const unsubscribe = aSession.subscribe()
    await waitFor(() => aSession.snapshot().builds === 2 && aSession.snapshot().buildState === "built")
    unsubscribe()
    await manager.dispose()
  })

  test("shared dependency rebuilds only subscribed packages and inactive package catches up on subscribe", async () => {
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
    const a = manager.session("@fixture/a")
    const b = manager.session("@fixture/b")
    const unsubscribeA = a.subscribe()
    expect(manager.notifyDependency(shared)).toBe(2)
    await waitFor(() => a.snapshot().builds === 2 && a.snapshot().buildState === "built")
    await Bun.sleep(15)
    expect(a.snapshot().builds).toBe(2)
    expect(b.snapshot()).toMatchObject({subscribers: 0, generation: 2, builds: 1})
    expect(manager.session("@fixture/c").snapshot().builds).toBe(0)

    const unsubscribeB = b.subscribe()
    await waitFor(() => b.snapshot().builds === 2 && b.snapshot().buildState === "built")
    expect(b.snapshot().revisions?.at(-1)?.generation).toBe(2)
    unsubscribeA()
    unsubscribeB()
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
    expect(manager.session("@fixture/a").snapshot().buildState).toBe("compiling")
    await manager.dispose()
    await a
  })

  test("distinguishes a queued package from the only admitted compiler", async () => {
    const root = fixtureRoot()
    let releaseA!: () => void
    let markAStarted!: () => void
    const aStarted = new Promise<void>((resolvePromise) => { markAStarted = resolvePromise })
    const aGate = new Promise<void>((resolvePromise) => { releaseA = resolvePromise })
    const startedPackages: string[] = []
    const manager = new ExternalStorybookSessionManager({
      artifactRoot: join(root, ".artifacts"),
      buildConcurrency: 1,
      buildRevision: async (input) => {
        startedPackages.push(input.descriptor.packageId)
        if (input.descriptor.packageId === "@fixture/a") {
          markAStarted()
          await aGate
        }
        return successfulBuild(input.stagingDirectory)
      },
    })
    manager.sync([descriptor(root, "a"), descriptor(root, "b")])
    const a = manager.ensure("@fixture/a", {owner: "open"})
    await aStarted
    const b = manager.ensure("@fixture/b", {owner: "check"})
    await Bun.sleep(0)
    expect(manager.session("@fixture/a").snapshot()).toMatchObject({
      buildState: "compiling",
      lastBuildReason: null,
    })
    expect(manager.session("@fixture/b").snapshot()).toMatchObject({
      buildState: "queued",
      lastBuildReason: null,
    })
    expect(startedPackages).toEqual(["@fixture/a"])
    expect(manager.buildSchedulerSnapshot()).toMatchObject({
      activeCount: 1,
      queuedCount: 1,
      active: [{packageId: "@fixture/a", owner: "open", reason: "missing", state: "running"}],
      queued: [{packageId: "@fixture/b", owner: "check", reason: "missing", state: "queued"}],
    })
    releaseA()
    await Promise.all([a, b])
    await manager.dispose()
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
    expect(session.invalidate(session.descriptor.watchedPaths![0]!)).toBeTrue()
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
      "module-doc.ts",
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
      {path: files["module-doc.ts"]!, category: "metadata"},
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
    expect(emitted(files["module-doc.ts"]!)).toEqual(["package.metadata-updated"])
    for (const name of ["fixture.json", "reference.json", "media.png", "evidence.json", "asset.svg"]) {
      expect(emitted(files[name]!)).toEqual(["package.resources-updated"])
    }
    expect(emitted(files["shared.ts"]!)).toEqual(["package.code-updated"])
    expect(manager.notifyDependency(files["unrelated.txt"]!)).toBe(0)
    expect(manager.notifyDependency(files["README.md"]!)).toBe(0)
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
  const sourcePath = join(packageRoot, "package.json")
  const modulePath = join(packageRoot, "module.ts")
  writeFileSync(sourcePath, JSON.stringify({name: `@fixture/${id}`}))
  writeFileSync(modulePath, "export const module = true\n")
  return {
    packageId: `@fixture/${id}`,
    packageRoot,
    projectRoot: root,
    sourcePath,
    declarationDigest,
    watchPaths,
    watchedPaths: [modulePath],
    graphSnapshot: graphSnapshot(`@fixture/${id}`, declarationDigest),
  }
}

function graphSnapshot(packageId: string, declarationDigest: string): StorybookPackageRevisionGraphSnapshot {
  const packageNode = `package:${packageId}`
  const directoryNode = `directory:${packageNode}/module`
  const urlPath = `/packages/${encodeURIComponent(packageId)}/`
  const withoutDigest = {
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest,
    metadata: {parentId: null, label: packageId, ownerId: packageId, urlPath},
    ancestors: [],
    rootId: packageNode,
    nodes: [
      {id: packageNode, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [directoryNode], urlPath, routePath: "", searchTerms: [packageId],
        hasModuleDocumentation: false, resourceUrl: `resources/nodes/${encodeURIComponent(packageNode)}/`},
      {id: directoryNode, kind: "directory" as const, ownerId: packageId, packageId, label: "module",
        parentId: packageNode, childIds: [], urlPath: `${urlPath}module`, routePath: "dir-module", searchTerms: ["module"],
        hasModuleDocumentation: false, resourceUrl: `resources/nodes/${encodeURIComponent(directoryNode)}/`},
    ],
    routes: [
      {path: "", urlPath, kind: "overview" as const, nodeId: packageNode},
      {path: "dir-module", urlPath: `${urlPath}module`, kind: "overview" as const, nodeId: directoryNode},
    ],
    resources: [],
    workbenchAuthorStyleSheets: [],
  }
  return Object.freeze({...withoutDigest,
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

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Storybook session manager state")
    await Bun.sleep(5)
  }
}
