import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {STORYBOOK_PACKAGE_GRAPH_PROTOCOL, type StorybookPackageRevisionGraphSnapshot} from "./package-revision.ts"
import {
  StorybookPackageSession,
  storybookBuildError,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageEvent,
  type StorybookPackageRevisionBuilder,
} from "./package-session.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("working Storybook PackageSession lifecycle", () => {
  test("keeps a successful build merely built until exact browser acknowledgement", async () => {
    const root = fixtureRoot("activation")
    const events: StorybookPackageEvent[] = []
    const session = createSession(descriptor(root, "@fixture/a"), successfulBuilder(), events)
    const built = await session.ensureBuilt()
    expect(built.buildState).toBe("built")
    expect(built.builtRevision).not.toBeNull()
    expect(built.activeRevision).toBeNull()
    expect(built.lastWorkingRevision).toBeNull()

    const activation = session.beginActivation({
      revision: built.builtRevision!,
      viewId: "view-a",
      route: "category/subject/default",
    })
    expect(() => session.acknowledgeActivation({
      ...activation,
      packageGraphDigest: "foreign-graph",
      frameSequence: 7,
    })).toThrow("does not match its lease")
    expect(session.snapshot().activeRevision).toBeNull()
    const working = session.acknowledgeActivation({
      ...activation,
      frameSequence: 7,
    })
    expect(working.buildState).toBe("active")
    expect(working.activeRevision).toBe(built.builtRevision!)
    expect(working.lastWorkingRevision).toBe(built.builtRevision!)
    expect(working.lastGoodRevision).toBe(built.builtRevision!)
    expect(events.map(({type}) => type)).toEqual([
      "package.built",
      "package.activating",
      "package.updated",
    ])
  })

  test("activation failure preserves previous active and lastWorking revision", async () => {
    const root = fixtureRoot("activation-failure")
    const events: StorybookPackageEvent[] = []
    const session = createSession(descriptor(root, "@fixture/a", "one"), successfulBuilder(), events)
    const first = await session.ensureBuilt()
    const firstActivation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const working = session.acknowledgeActivation({...firstActivation, frameSequence: 1})

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const second = await session.ensureBuilt()
    const secondActivation = session.beginActivation({
      revision: second.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const failed = session.failActivation({
      revision: secondActivation.revision,
      activationId: secondActivation.activationId,
      diagnostic: storybookDiagnostic("activation", "runtime.create failed"),
    })
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBe(working.activeRevision)
    expect(failed.lastWorkingRevision).toBe(working.lastWorkingRevision)
    expect(failed.failedRevision).toBe(secondActivation.revision)
    expect(failed.diagnostics[0]?.message).toBe("runtime.create failed")
  })

  test("restarts the exact activation lease on a repeated candidate page request", async () => {
    const root = fixtureRoot("activation-restart")
    const session = createSession(descriptor(root, "@fixture/a"), successfulBuilder(), [])
    const built = await session.ensureBuilt()
    const first = session.beginActivation({
      revision: built.builtRevision!, viewId: "view-first", route: "category/subject/default",
    })
    const second = session.beginActivation({
      revision: built.builtRevision!, viewId: "view-second", route: "category/subject/default",
    })
    expect(second.activationId).not.toBe(first.activationId)
    expect(() => session.acknowledgeActivation({...first, frameSequence: 1})).toThrow("stale")
    const working = session.acknowledgeActivation({...second, frameSequence: 1})
    expect(working.activeRevision).toBe(built.builtRevision!)
    expect(working.lastWorkingRevision).toBe(built.builtRevision!)
  })

  test("compile failure preserves working revision and package-local diagnostics", async () => {
    const root = fixtureRoot("compile-failure")
    let fail = false
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      if (fail) throw storybookBuildError(storybookDiagnostic("compile", "Unexpected token", input.descriptor.runtime!.path))
      return successfulBuild(input.stagingDirectory)
    }, [])
    const first = await session.ensureBuilt()
    const activation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const working = session.acknowledgeActivation({...activation, frameSequence: 1})
    fail = true
    session.reconfigure(descriptor(root, "@fixture/a", "broken"))
    const failed = await session.ensureBuilt()
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBe(working.activeRevision)
    expect(failed.lastWorkingRevision).toBe(working.lastWorkingRevision)
    expect(failed.diagnostics[0]?.message).toBe("Unexpected token")
  })

  test("coalesces one generation and cancels a superseded build before building latest", async () => {
    const root = fixtureRoot("queue")
    let calls = 0
    let firstStarted!: () => void
    const started = new Promise<void>((resolvePromise) => { firstStarted = resolvePromise })
    const session = createSession(descriptor(root, "@fixture/a", "one"), async (input) => {
      calls += 1
      if (calls === 1) {
        firstStarted()
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), {once: true})
        })
      }
      return successfulBuild(input.stagingDirectory)
    }, [])
    const first = session.ensureBuilt()
    const duplicate = session.ensureBuilt()
    await started
    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const latest = session.ensureBuilt()
    await Promise.all([first, duplicate, latest])
    expect(calls).toBe(2)
    expect(session.snapshot().generation).toBe(2)
    expect(session.snapshot().buildState).toBe("built")
    expect(session.snapshot().revisions?.at(-1)?.declarationDigest).toBe("digest-two")
  })

  test("detach aborts exact build and dispose is idempotent", async () => {
    const root = fixtureRoot("dispose")
    let aborted = false
    let started!: () => void
    const gate = new Promise<void>((resolvePromise) => { started = resolvePromise })
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      started()
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener("abort", () => {
        aborted = true
        reject(input.signal.reason)
      }, {once: true}))
      return successfulBuild(input.stagingDirectory)
    }, [])
    void session.ensureBuilt()
    await gate
    const first = session.dispose()
    const second = session.dispose()
    expect(first).toBe(second)
    await first
    expect(aborted).toBeTrue()
    expect(session.snapshot().buildState).toBe("disposed")
  })

  test("retains leased history and collects it after release", async () => {
    const root = fixtureRoot("retention")
    const session = createSession(
      descriptor(root, "@fixture/a", "one"),
      successfulBuilder(),
      [],
      {retainedRevisionLimit: 0},
    )
    const first = await session.ensureBuilt()
    const firstActivation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const firstWorking = session.acknowledgeActivation({...firstActivation, frameSequence: 1})
    const oldRevision = firstWorking.activeRevision!
    const lease = session.acquireRevisionLease(oldRevision, "view-lease")

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const second = await session.ensureBuilt()
    const secondActivation = session.beginActivation({
      revision: second.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    session.acknowledgeActivation({...secondActivation, frameSequence: 2})
    expect(session.revisionDirectory(oldRevision)).not.toBeNull()
    lease.release()
    expect(session.revisionDirectory(oldRevision)).toBeNull()
    const activeRevision = session.snapshot().activeRevision!
    const activeLease = session.acquireRevisionLease(activeRevision, "active-view")
    await session.dispose()
    expect(session.revisionDirectory(activeRevision)).not.toBeNull()
    activeLease.release()
    expect(session.revisionDirectory(activeRevision)).toBeNull()
  })
})

function createSession(
  value: StorybookPackageBuildDescriptor,
  buildRevision: StorybookPackageRevisionBuilder,
  events: StorybookPackageEvent[],
  overrides: Readonly<{retainedRevisionLimit?: number}> = {},
): StorybookPackageSession {
  return new StorybookPackageSession(value, {
    artifactRoot: join(value.projectRoot, ".artifacts"),
    buildRevision,
    rebuildDelayMs: 0,
    publish: (event) => events.push(event),
    ...overrides,
  })
}

function descriptor(root: string, packageId: string, version = "one"): StorybookPackageBuildDescriptor {
  const runtime = join(root, "runtime.ts")
  const story = join(root, "story.ts")
  const manifest = join(root, "manifest.json")
  writeFileSync(runtime, "export const runtime = {}\n")
  writeFileSync(story, "export const story = {}\n")
  writeFileSync(manifest, "{}\n")
  const declarationDigest = `digest-${version}`
  return {
    packageId,
    packageRoot: root,
    projectRoot: root,
    manifestPath: manifest,
    declarationDigest,
    graphSnapshot: graphSnapshot(packageId, declarationDigest),
    runtime: {path: runtime, export: "runtime"},
    variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
  }
}

function graphSnapshot(packageId: string, declarationDigest: string): StorybookPackageRevisionGraphSnapshot {
  const packageNodeId = `package:${packageId}`
  const variantNodeId = `variant:${packageId}/category/subject/default`
  const withoutDigest = {
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest,
    metadata: {label: packageId, ownerId: packageId, urlPath: `/packages/${encodeURIComponent(packageId)}/`},
    rootId: packageNodeId,
    nodes: [
      {
        id: packageNodeId, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [], urlPath: `/packages/${encodeURIComponent(packageId)}/`, routePath: "",
        searchTerms: [packageId], group: null, subjectKind: null, apiName: null, hasReadme: false,
        resourceKinds: [], resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(packageNodeId)}/`,
      },
      {
        id: variantNodeId, kind: "variant" as const, ownerId: packageId, packageId, label: "Default",
        parentId: packageNodeId, childIds: [],
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        routePath: "category/subject/default", searchTerms: ["default"], group: null, subjectKind: null,
        apiName: null, hasReadme: false, resourceKinds: [],
        resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(variantNodeId)}/`,
      },
    ],
    routes: [
      {path: "", urlPath: `/packages/${encodeURIComponent(packageId)}/`, kind: "overview" as const, nodeId: packageNodeId},
      {
        path: "category/subject/default",
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        kind: "variant" as const,
        nodeId: variantNodeId,
      },
    ],
    loaders: [{route: "category/subject/default", nodeId: variantNodeId, exportName: "story"}],
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
  return {moduleGraphRevision: "module-graph-revision", dependencyRealpaths: [], entryRelativePath: "entry.js"}
}

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `storybook-session-${name}-`))
  roots.push(root)
  return root
}
