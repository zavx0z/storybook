import AppServerSessionsOwner, {type AppServerSessions as AppServerSessionsContract} from "@app-server/sessions"
import PackageRevisionOwner, {type PackageRevision as PackageRevisionContract} from "@package/revision"
import {type PackageSession as PackageSessionContract} from "@package/session"
const ExternalStorybookSessionManager = AppServerSessionsOwner
const STORYBOOK_PACKAGE_GRAPH_PROTOCOL = PackageRevisionOwner.protocol
type ExternalStorybookSessionManager = AppServerSessionsContract.Output
type StorybookPackageRevisionGraphSnapshot = ReturnType<PackageRevisionContract.Output["create"]>
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageEvent = Parameters<NonNullable<PackageSessionContract.Input[1]["publish"]>>[0]
type StorybookPackageRevisionBuilder = PackageSessionContract.Input[1]["buildRevision"]
import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

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
    expect(aSession.snapshot().builds).toBe(1)
    await manager.ensure("@fixture/a", {owner: "check"})
    await waitFor(() => aSession.snapshot().builds === 2 && aSession.snapshot().buildState === "built")
    unsubscribe()
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



  test("подписка и изменения файлов не собирают пакет до явной проверки", async () => {
    const root = fixtureRoot()
    const manager = new ExternalStorybookSessionManager({artifactRoot: join(root, ".artifacts"), buildRevision: successfulBuilder()})
    const value = descriptor(root, "explicit")
    manager.sync([value])
    const session = manager.session("@fixture/explicit")
    const unsubscribe = session.subscribe()
    expect(session.snapshot().builds).toBe(0)
    await manager.ensure(session.packageId, {owner: "check"})
    const revision = session.snapshot().builtRevision
    const empty = join(value.packageRoot, "empty")
    mkdirSync(empty)
    rmSync(empty, {recursive: true})
    writeFileSync(value.sourcePath, JSON.stringify({name: session.packageId, description: "изменено"}))
    await Bun.sleep(1100)
    expect(session.snapshot()).toMatchObject({builds: 1, builtRevision: revision})
    manager.sync([descriptor(root, "explicit", "changed")])
    expect(session.snapshot().builds).toBe(1)
    await manager.ensure(session.packageId, {owner: "check"})
    expect(session.snapshot().builds).toBe(2)
    unsubscribe()
    await manager.dispose()
  })

})

function descriptor(
  root: string,
  id: string,
  declarationDigest = id,
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
    repo: root,
    sourcePath,
    declarationDigest,
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
