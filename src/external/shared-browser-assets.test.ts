import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from "node:fs"
import {join} from "node:path"
import {StorybookDependencyWatchCoordinator} from "./dependency-watch.ts"
import {StorybookSharedBrowserAssets, type SharedBrowserAssets} from "./shared-browser-assets.ts"

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function fixture() {
  const root = mkdtempSync(join(import.meta.dir, ".shared-test-"))
  cleanups.push(() => rmSync(root, {recursive: true, force: true}))
  const path = join(root, "view.txt")
  writeFileSync(path, "first")
  const watch = new StorybookDependencyWatchCoordinator({watchFile() {}, unwatchFile() {}})
  cleanups.push(() => watch.dispose())
  const updates: string[] = []
  const errors: unknown[] = []
  let builds = 0
  let pause: (() => Promise<void>) | null = null
  const cache = new StorybookSharedBrowserAssets({
    watch,
    subscribed: () => true,
    updated: assets => { updates.push(assets.landingEntry) },
    failed: error => { errors.push(error) },
    async build(): Promise<SharedBrowserAssets> {
      builds += 1
      const content = readFileSync(path, "utf8")
      if (content === "invalid") throw new Error("compile failed")
      await pause?.()
      return {root, landingEntry: `${content}.js`, fallbackEntry: "fallback.js", dependencyRealpaths: [path]}
    },
  })
  cleanups.push(() => cache.dispose())
  return {cache, watch, path, updates, errors, builds: () => builds, pause: (value: typeof pause) => { pause = value }}
}

describe("shared browser assets", () => {
  test("reuses a build and detects a changed dependency even before its watcher fires", async () => {
    const f = fixture()
    const [first, concurrent] = await Promise.all([f.cache.ensure(), f.cache.ensure()])
    expect(first).toBe(concurrent)
    expect(await f.cache.ensure()).toBe(first)
    expect(f.builds()).toBe(1)
    writeFileSync(f.path, "second")
    expect((await f.cache.ensure()).landingEntry).toBe("second.js")
    expect(f.builds()).toBe(2)
    expect(f.updates).toEqual(["second.js"])
  })

  test("keeps the previous build on failure and retries after repair", async () => {
    const f = fixture()
    const first = await f.cache.ensure()
    writeFileSync(f.path, "invalid")
    expect(await f.cache.ensure()).toBe(first)
    expect(f.errors).toHaveLength(1)
    expect(f.updates).toEqual([])
    writeFileSync(f.path, "repaired")
    expect((await f.cache.ensure()).landingEntry).toBe("repaired.js")
    expect(f.updates).toEqual(["repaired.js"])
  })

  test("does not permanently cache an initial rejected build", async () => {
    const f = fixture()
    writeFileSync(f.path, "invalid")
    await expect(f.cache.ensure()).rejects.toThrow("compile failed")
    writeFileSync(f.path, "repaired")
    expect((await f.cache.ensure()).landingEntry).toBe("repaired.js")
  })

  test("coalesces subscriptions and retries a change that arrives during compilation", async () => {
    const f = fixture()
    await f.cache.ensure()
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    f.pause(() => new Promise<void>(resolve => { release = resolve; entered() }))
    writeFileSync(f.path, "second")
    f.watch.notify(f.path)
    await waiting
    writeFileSync(f.path, "third")
    f.watch.notify(f.path)
    f.pause(null)
    release()
    expect((await f.cache.ensure()).landingEntry).toBe("third.js")
    expect(f.updates).toEqual(["third.js"])
    expect(f.builds()).toBe(3)
  })
})
