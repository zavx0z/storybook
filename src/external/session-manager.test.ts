import {afterEach, describe, expect, spyOn, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {ExternalStorybookSessionManager} from "./session-manager.ts"
import {StorybookDependencyWatchCoordinator} from "./dependency-watch.ts"
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
    manager.sync([{...a, declarationDigest: "a-next"}])
    expect(manager.session("@fixture/a")).toBe(aSession)
    await Bun.sleep(15)
    expect(manager.snapshots()).toHaveLength(1)
    expect(manager.snapshots()[0]?.declarationDigest).toBe("a-next")
    expect(events.some(({type, packageId}) =>
      type === "package.detached" && packageId === "@fixture/b")).toBeTrue()
    manager.dispose()
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
    manager.dispose()
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
    const result = await manager.session("@fixture/watch").build()
    expect(result.buildState).toBe("ready")
    expect(result.activeRevision).toBe(result.lastGoodRevision)
    expect(events.at(-1)?.type).toBe("package.updated")
    expect(errors).toHaveBeenCalled()
    manager.dispose()
    errors.mockRestore()
  })
})

function descriptor(root: string, id: string): StorybookPackageBuildDescriptor {
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
    declarationDigest: id,
    runtime: {path: runtime, export: "runtime"},
    variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
  }
}

function successfulBuilder(): StorybookPackageRevisionBuilder {
  return async ({stagingDirectory}) => {
    mkdirSync(stagingDirectory, {recursive: true})
    writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
    return {moduleGraphRevision: "graph", dependencyRealpaths: [], entryRelativePath: "entry.js"}
  }
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-session-manager-"))
  roots.push(root)
  return root
}
