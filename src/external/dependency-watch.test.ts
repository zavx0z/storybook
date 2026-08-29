import {afterEach, describe, expect, test} from "bun:test"
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  StorybookDependencyWatchCoordinator,
  StorybookDirtyRefreshCoordinator,
  type StorybookDependencyWatchError,
  type StorybookDependencyUnwatchFile,
  type StorybookDependencyWatchFile,
  type StorybookDependencyWatchListener,
} from "./dependency-watch.ts"

const roots: string[] = []
const coordinators: StorybookDependencyWatchCoordinator[] = []

afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose()
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("shared external Storybook dependency watch", () => {
  test("owns one canonical watcher for a dependency shared by A and B", () => {
    const root = fixtureRoot()
    const source = sourceFile(root, "shared.ts")
    const alias = join(root, "shared-alias.ts")
    symlinkSync(source, alias)
    const watcher = fakeWatcher()
    const errors: string[] = []
    const coordinator = createCoordinator(watcher, {
      onError: ({packageId}) => errors.push(packageId),
    })
    const calls: string[] = []

    coordinator.replace("@fixture/a", [source], (path) => {
      calls.push(`a:${path}`)
      throw new Error("A callback failed")
    })
    coordinator.replace("@fixture/b", [alias, source], (path) => calls.push(`b:${path}`))

    const canonical = realpathSync(source)
    expect(watcher.watchCalls).toEqual([{
      path: canonical,
      options: {persistent: false, interval: 75},
    }])
    expect(coordinator.notify(alias)).toBe(2)
    expect(calls).toEqual([`a:${canonical}`, `b:${canonical}`])
    expect(errors).toEqual(["@fixture/a"])

    calls.length = 0
    watcher.emit(canonical)
    expect(calls).toEqual([`a:${canonical}`, `b:${canonical}`])
    expect(watcher.watchCalls).toHaveLength(1)
  })

  test("replace updates ownership without restarting a retained shared watcher", () => {
    const root = fixtureRoot()
    const first = sourceFile(root, "first.ts")
    const shared = sourceFile(root, "shared.ts")
    const watcher = fakeWatcher()
    const coordinator = createCoordinator(watcher)
    const calls: string[] = []

    coordinator.replace("@fixture/a", [first, shared], (path) => calls.push(`old:${path}`))
    coordinator.replace("@fixture/b", [shared], (path) => calls.push(`b:${path}`))
    coordinator.replace("@fixture/a", [shared], (path) => calls.push(`new:${path}`))

    const canonicalFirst = realpathSync(first)
    const canonicalShared = realpathSync(shared)
    expect(watcher.watchCalls.map(({path}) => path).sort()).toEqual([
      canonicalFirst,
      canonicalShared,
    ].sort())
    expect(watcher.unwatchCalls).toEqual([canonicalFirst])
    expect(coordinator.notify(shared)).toBe(2)
    expect(calls).toEqual([`new:${canonicalShared}`, `b:${canonicalShared}`])

    expect(coordinator.remove("@fixture/a")).toBeTrue()
    expect(watcher.unwatchCalls).toEqual([canonicalFirst])
    expect(coordinator.notify(shared)).toBe(1)
    expect(coordinator.remove("@fixture/b")).toBeTrue()
    expect(watcher.unwatchCalls).toEqual([canonicalFirst, canonicalShared])
    expect(coordinator.remove("@fixture/b")).toBeFalse()
  })

  test("keeps canonical identity while a watched dependency is deleted and recreated", () => {
    const root = fixtureRoot()
    const source = sourceFile(root, "replaceable.ts")
    const canonical = realpathSync(source)
    const watcher = fakeWatcher()
    const coordinator = createCoordinator(watcher)
    const calls: string[] = []
    coordinator.replace("@fixture/a", [source], (path) => calls.push(path))

    unlinkSync(source)
    expect(coordinator.notify(source)).toBe(1)
    writeFileSync(source, "export const version = 2\n")
    expect(coordinator.notify(source)).toBe(1)
    expect(calls).toEqual([canonical, canonical])
    expect(watcher.watchCalls).toHaveLength(1)
  })

  test("dispose is idempotent and releases every underlying watcher once", () => {
    const root = fixtureRoot()
    const first = sourceFile(root, "first.ts")
    const second = sourceFile(root, "second.ts")
    const watcher = fakeWatcher()
    const coordinator = createCoordinator(watcher)
    coordinator.replace("@fixture/a", [first, second], () => {})

    coordinator.dispose()
    coordinator.dispose()

    expect(watcher.unwatchCalls.sort()).toEqual([
      realpathSync(first),
      realpathSync(second),
    ].sort())
    expect(coordinator.notify(first)).toBe(0)
    expect(coordinator.remove("@fixture/a")).toBeFalse()
    expect(() => coordinator.replace("@fixture/a", [first], () => {})).toThrow("disposed")
  })

  test("rejects an invalid interval before creating any watcher", () => {
    expect(() => new StorybookDependencyWatchCoordinator({intervalMs: 0}))
      .toThrow("Invalid Storybook dependency watch interval")
  })

  test("projects typed categories over one canonical watcher", () => {
    const root = fixtureRoot()
    const metadata = sourceFile(root, "package.json")
    const story = sourceFile(root, "story.ts")
    const watcher = fakeWatcher()
    const coordinator = createCoordinator(watcher)
    const events: Array<Readonly<{path: string, categories: readonly string[]}>> = []

    coordinator.replaceCategorized("@fixture/a", [
      {path: metadata, category: "metadata"},
      {path: metadata, category: "code"},
      {path: story, category: "code"},
    ], ({path, categories}) => events.push({path, categories}))

    expect(watcher.watchCalls).toHaveLength(2)
    coordinator.notify(metadata)
    coordinator.notify(story)
    expect(events).toEqual([
      {path: realpathSync(metadata), categories: ["code", "metadata"]},
      {path: realpathSync(story), categories: ["code"]},
    ])
  })

  test("does not lose a refresh requested during the active refresh", async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const errors: string[] = []
    const refresh = new StorybookDirtyRefreshCoordinator(async () => {
      calls += 1
      if (calls === 1) await gate
      if (calls === 3) throw new Error("refresh failed")
    }, (error) => errors.push(error instanceof Error ? error.message : String(error)))

    const first = refresh.request()
    refresh.request()
    refresh.request()
    release()
    await first
    expect(calls).toBe(2)

    await refresh.request()
    expect(calls).toBe(3)
    expect(errors).toEqual(["refresh failed"])
    await refresh.request()
    expect(calls).toBe(4)
    await refresh.wait()
  })
})

type FakeWatcher = Readonly<{
  watchFile: StorybookDependencyWatchFile
  unwatchFile: StorybookDependencyUnwatchFile
  watchCalls: Array<Readonly<{
    path: string
    options: Readonly<{persistent: false; interval: number}>
  }>>
  unwatchCalls: string[]
  emit(path: string): void
}>

function fakeWatcher(): FakeWatcher {
  const listeners = new Map<string, StorybookDependencyWatchListener>()
  const watchCalls: FakeWatcher["watchCalls"] = []
  const unwatchCalls: string[] = []
  return {
    watchCalls,
    unwatchCalls,
    watchFile(path, options, listener) {
      if (listeners.has(path)) throw new Error(`duplicate watcher: ${path}`)
      listeners.set(path, listener)
      watchCalls.push({path, options})
    },
    unwatchFile(path, listener) {
      expect(listeners.get(path)).toBe(listener)
      listeners.delete(path)
      unwatchCalls.push(path)
    },
    emit(path) {
      const listener = listeners.get(path)
      if (listener === undefined) throw new Error(`missing watcher: ${path}`)
      listener({} as Stats, {} as Stats)
    },
  }
}

function createCoordinator(
  watcher: FakeWatcher,
  options: Readonly<{
    onError?(error: StorybookDependencyWatchError): void
  }> = {},
): StorybookDependencyWatchCoordinator {
  const coordinator = new StorybookDependencyWatchCoordinator({
    intervalMs: 75,
    watchFile: watcher.watchFile,
    unwatchFile: watcher.unwatchFile,
    ...(options.onError === undefined ? {} : {onError: options.onError}),
  })
  coordinators.push(coordinator)
  return coordinator
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "external-storybook-watch-"))
  roots.push(root)
  return root
}

function sourceFile(root: string, name: string): string {
  const path = join(root, name)
  writeFileSync(path, "export const version = 1\n")
  return path
}
