import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
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

describe("independent Storybook PackageSession", () => {
  test("publishes immutable active and last-good revisions", async () => {
    const root = fixtureRoot("a")
    const events: StorybookPackageEvent[] = []
    const session = createSession(descriptor(root, "@fixture/a"), successfulBuilder(), events)
    const first = await session.build()
    expect(first.buildState).toBe("ready")
    expect(first.activeRevision).toBe(first.lastGoodRevision)
    expect(session.revisionDirectory()).not.toBeNull()

    const second = await session.build()
    expect(second.activeRevision).not.toBe(first.activeRevision)
    expect(second.lastGoodRevision).toBe(second.activeRevision)
    expect(session.revisionDirectory(first.activeRevision)).not.toBeNull()
    expect(events.map(({type}) => type)).toEqual(["package.updated", "package.updated"])
  })

  test("keeps last-good and isolates diagnostics after a failed candidate", async () => {
    const root = fixtureRoot("a")
    let fail = false
    const events: StorybookPackageEvent[] = []
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      if (fail) throw storybookBuildError(storybookDiagnostic("compile", "Unexpected token", input.descriptor.runtime!.path))
      return successfulBuild(input.stagingDirectory)
    }, events)
    const good = await session.build()
    fail = true
    const failed = await session.build()
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBe(good.activeRevision)
    expect(failed.lastGoodRevision).toBe(good.lastGoodRevision)
    expect(failed.diagnostics[0]?.message).toBe("Unexpected token")
    expect(events.at(-1)?.type).toBe("package.failed")
  })

  test("A failure never changes B or unopened C", async () => {
    const aRoot = fixtureRoot("a")
    const bRoot = fixtureRoot("b")
    const cRoot = fixtureRoot("c")
    const a = createSession(descriptor(aRoot, "@fixture/a"), async () => {
      throw new Error("A failed")
    }, [])
    const b = createSession(descriptor(bRoot, "@fixture/b"), successfulBuilder(), [])
    const c = createSession(descriptor(cRoot, "@fixture/c"), successfulBuilder(), [])
    const [aState, bState] = await Promise.all([a.build(), b.build()])
    expect(aState.buildState).toBe("failed")
    expect(bState.buildState).toBe("ready")
    expect(c.snapshot().builds).toBe(0)
    expect(c.snapshot().buildState).toBe("idle")
  })

  test("invalidates only sessions whose canonical graph contains a path", async () => {
    const shared = fixtureRoot("shared")
    const source = join(shared, "source.ts")
    writeFileSync(source, "export const shared = true\n")
    const aRoot = fixtureRoot("a")
    const bRoot = fixtureRoot("b")
    const cRoot = fixtureRoot("c")
    const builder = (dependencies: readonly string[]): StorybookPackageRevisionBuilder =>
      async ({stagingDirectory}) => ({...successfulBuild(stagingDirectory), dependencyRealpaths: dependencies})
    const a = createSession(descriptor(aRoot, "@fixture/a"), builder([source]), [])
    const b = createSession(descriptor(bRoot, "@fixture/b"), builder([source]), [])
    const c = createSession(descriptor(cRoot, "@fixture/c"), builder([]), [])
    await Promise.all([a.build(), b.build(), c.build()])
    expect(a.invalidate(source)).toBeTrue()
    expect(b.invalidate(source)).toBeTrue()
    expect(c.invalidate(source)).toBeFalse()
    await Bun.sleep(15)
    expect(a.snapshot().builds).toBe(2)
    expect(b.snapshot().builds).toBe(2)
    expect(c.snapshot().builds).toBe(1)
  })

  test("detach disposes only the selected session", async () => {
    const aRoot = fixtureRoot("a")
    const bRoot = fixtureRoot("b")
    const events: StorybookPackageEvent[] = []
    const a = createSession(descriptor(aRoot, "@fixture/a"), successfulBuilder(), events)
    const b = createSession(descriptor(bRoot, "@fixture/b"), successfulBuilder(), events)
    await Promise.all([a.build(), b.build()])
    a.dispose()
    expect(a.snapshot().buildState).toBe("disposed")
    expect(b.snapshot().buildState).toBe("ready")
    expect(events.at(-1)).toEqual({type: "package.detached", packageId: "@fixture/a"})
  })

  test("reconfiguration keeps last-good while a new declaration candidate fails", async () => {
    const root = fixtureRoot("reconfigure")
    let fail = false
    const session = createSession(descriptor(root, "@fixture/reconfigure"), async ({stagingDirectory}) => {
      if (fail) throw new Error("new declaration failed")
      return successfulBuild(stagingDirectory)
    }, [])
    const good = await session.build()
    fail = true
    const changed = session.reconfigure({
      ...session.descriptor,
      declarationDigest: "new-declaration",
    })
    expect(changed).toBeTrue()
    await Bun.sleep(15)
    const failed = session.snapshot()
    expect(failed.buildState).toBe("failed")
    expect(failed.lastGoodRevision).toBe(good.lastGoodRevision)
    expect(failed.activeRevision).toBe(good.activeRevision)
  })

  test("concurrent check waits for the latest queued descriptor build", async () => {
    const root = fixtureRoot("queued")
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise })
    let calls = 0
    const session = createSession(descriptor(root, "@fixture/queued"), async ({stagingDirectory}) => {
      calls += 1
      if (calls === 1) await firstGate
      return successfulBuild(stagingDirectory)
    }, [])
    const first = session.build()
    session.reconfigure({...session.descriptor, declarationDigest: "queued-latest"})
    const check = session.build()
    releaseFirst()
    const [firstResult, checkResult] = await Promise.all([first, check])
    expect(calls).toBe(2)
    expect(checkResult.declarationDigest).toBe("queued-latest")
    expect(checkResult.buildState).toBe("ready")
    expect(firstResult.activeRevision).toBe(checkResult.activeRevision)
  })
})

function createSession(
  value: StorybookPackageBuildDescriptor,
  buildRevision: StorybookPackageRevisionBuilder,
  events: StorybookPackageEvent[],
): StorybookPackageSession {
  return new StorybookPackageSession(value, {
    artifactRoot: join(value.projectRoot, ".artifacts"),
    buildRevision,
    rebuildDelayMs: 0,
    publish: (event) => events.push(event),
  })
}

function descriptor(root: string, packageId: string): StorybookPackageBuildDescriptor {
  const runtime = join(root, "runtime.ts")
  const story = join(root, "story.ts")
  const manifest = join(root, "manifest.json")
  writeFileSync(runtime, "export const runtime = {}\n")
  writeFileSync(story, "export const story = {}\n")
  writeFileSync(manifest, "{}\n")
  return {
    packageId,
    packageRoot: root,
    projectRoot: root,
    manifestPath: manifest,
    declarationDigest: `digest-${packageId}`,
    runtime: {path: runtime, export: "runtime"},
    variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
  }
}

function successfulBuilder(): StorybookPackageRevisionBuilder {
  return async ({stagingDirectory}) => successfulBuild(stagingDirectory)
}

function successfulBuild(stagingDirectory: string) {
  mkdirSync(stagingDirectory, {recursive: true})
  writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
  return {
    moduleGraphRevision: "module-graph-revision",
    dependencyRealpaths: [],
    entryRelativePath: "entry.js",
  }
}

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `storybook-session-${name}-`))
  roots.push(root)
  return root
}
