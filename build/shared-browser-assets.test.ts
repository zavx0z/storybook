import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {StorybookSharedBrowserAssets, type SharedBrowserAssets} from "./shared-browser-assets.ts"

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

test("dispose отменяет shared build и ждёт завершения его собственного lifecycle", async () => {
  let release!: () => void
  let signal: AbortSignal | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const errors: unknown[] = []
  const cache = new StorybookSharedBrowserAssets({
    updated() {},
    failed: error => errors.push(error),
    async build(currentSignal) {
      signal = currentSignal
      await gate
      currentSignal.throwIfAborted()
      throw new Error("unreachable")
    },
  })
  const build = cache.ensure()
  const outcome = build.then(() => null, error => error)
  let disposed = false
  const closing = cache.dispose().then(() => { disposed = true })
  expect(signal?.aborted).toBe(true)
  await Promise.resolve()
  expect(disposed).toBe(false)
  release()
  await closing
  expect((await outcome)?.message).toContain("disposed")
  expect(disposed).toBe(true)
  expect(errors).toEqual([])
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "storybook-shared-test-"))
  cleanups.push(() => rmSync(root, {recursive: true, force: true}))
  const path = join(root, "view.txt")
  writeFileSync(path, "first")
  const updates: string[] = []
  const errors: unknown[] = []
  const cacheProgress: Array<Readonly<{state: "started" | "completed", hit?: boolean}>> = []
  let builds = 0
  let pause: (() => Promise<void>) | null = null
  const cache = new StorybookSharedBrowserAssets({
    updated: assets => { updates.push(assets.landingEntry) },
    failed: error => { errors.push(error) },
    cacheProgress: event => cacheProgress.push(event),
    async build(): Promise<SharedBrowserAssets> {
      builds += 1
      const content = readFileSync(path, "utf8")
      if (content === "invalid") throw new Error("compile failed")
      await pause?.()
      return {root, landingEntry: `${content}.js`, fallbackEntry: "fallback.js", dependencyRealpaths: [path]}
    },
  })
  cleanups.push(() => cache.dispose())
  return {cache, path, updates, errors, cacheProgress, builds: () => builds, pause: (value: typeof pause) => { pause = value }}
}

describe("shared browser assets", () => {
  test("проверяет изменения только по явному запросу и повторно использует готовую сборку", async () => {
    const f = fixture()
    const [first, concurrent] = await Promise.all([f.cache.ensure(), f.cache.ensure()])
    expect(first).toBe(concurrent)
    expect(await f.cache.ensure()).toBe(first)
    expect(f.builds()).toBe(1)
    expect(() => f.cache.current()).toThrow()
    expect(f.updates).toEqual([])
    f.cache.publish()
    writeFileSync(f.path, "second")
    expect((await f.cache.ensure()).landingEntry).toBe("second.js")
    expect(f.builds()).toBe(2)
    expect(f.cache.current().landingEntry).toBe("first.js")
    f.cache.publish()
    expect(f.updates).toEqual(["first.js", "second.js"])
    expect(f.cacheProgress).toEqual([
      {state: "started"},
      {state: "completed", hit: true},
      {state: "started"},
      {state: "completed", hit: false},
    ])
  })

  test("keeps the previous build on failure and retries after repair", async () => {
    const f = fixture()
    await f.cache.ensure()
    const first = f.cache.publish()
    writeFileSync(f.path, "invalid")
    await expect(f.cache.ensure()).rejects.toThrow("compile failed")
    expect(f.cache.current()).toBe(first)
    expect(f.errors).toHaveLength(1)
    expect(f.updates).toEqual(["first.js"])
    writeFileSync(f.path, "repaired")
    expect((await f.cache.ensure()).landingEntry).toBe("repaired.js")
    expect(f.cache.current()).toBe(first)
    f.cache.publish()
    expect(f.updates).toEqual(["first.js", "repaired.js"])
  })

  test("does not permanently cache an initial rejected build", async () => {
    const f = fixture()
    writeFileSync(f.path, "invalid")
    await expect(f.cache.ensure()).rejects.toThrow("compile failed")
    writeFileSync(f.path, "repaired")
    expect((await f.cache.ensure()).landingEntry).toBe("repaired.js")
  })


  test("изменения исходника и пустой директории сохраняют готовую оболочку до check", async () => {
    const f = fixture()
    await f.cache.ensure()
    const first = f.cache.publish()
    writeFileSync(f.path, "second")
    await Bun.sleep(1100)
    expect(f.cache.current()).toBe(first)
    expect(f.builds()).toBe(1)
    expect((await f.cache.ensure()).landingEntry).toBe("second.js")
  })

})


test("ошибка публикации сохраняет применённую оболочку и не отправляет событие", async () => {
  const initial = {root: "/fixture", landingEntry: "first.js", fallbackEntry: "first.js", dependencyRealpaths: []}
  const updated: SharedBrowserAssets[] = []
  const cache = new StorybookSharedBrowserAssets({
    initial,
    build: async () => ({...initial, landingEntry: "second.js"}),
    commit() { throw new Error("receipt write failed") },
    updated: assets => { updated.push(assets) },
    failed() {},
  })
  try {
    await cache.ensure()
    expect(() => cache.publish()).toThrow("receipt write failed")
    expect(cache.current()).toBe(initial)
    expect(updated).toEqual([])
  } finally { await cache.dispose() }
})


test("конкурентная подготовка не подменяет кандидата после проверки", async () => {
  const f = fixture()
  const checked = await f.cache.ensure()
  f.cache.publish([], checked)
  writeFileSync(f.path, "second")
  await f.cache.ensure()
  expect(() => f.cache.publish([], checked)).toThrow("candidate changed")
  expect(f.cache.current().landingEntry).toBe("first.js")
  expect(f.updates).toEqual(["first.js"])
})
