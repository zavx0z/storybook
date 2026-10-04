import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {StorybookSharedBrowserAssets} from "../src/assets"
import type {SharedBrowserAssets} from "../contract/assets"
import Environment from "@storybook-tech-build/environment"

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
  let builds = 0
  let pause: (() => Promise<void>) | null = null
  const cache = new StorybookSharedBrowserAssets({
    updated: assets => { updates.push(assets.landingEntry) },
    failed: error => { errors.push(error) },
    async build(): Promise<SharedBrowserAssets> {
      builds += 1
      const content = readFileSync(path, "utf8")
      if (content === "invalid") throw new Error("compile failed")
      await pause?.()
      return {root, landingEntry: `${content}.js`, fallbackEntry: "fallback.js"}
    },
  })
  cleanups.push(() => cache.dispose())
  return {cache, path, updates, errors, builds: () => builds, pause: (value: typeof pause) => { pause = value }}
}

describe("shared browser assets", () => {
  test("каждый явный запрос собирает заново, одновременные запросы разделяют одну сборку", async () => {
    const f = fixture()
    const [first, concurrent] = await Promise.all([f.cache.ensure(), f.cache.ensure()])
    expect(first).toBe(concurrent)
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
  })

  test("keeps the previous build on failure and retries after repair", async () => {
    const f = fixture()
    await f.cache.ensure()
    const first = f.cache.publish()
    writeFileSync(f.path, "invalid")
    await expect(f.cache.ensure()).rejects.toThrow("compile failed")
    expect(f.cache.current()).toBe(first)
    expect(f.cache.prepared()).toBeNull()
    expect(() => f.cache.publish()).toThrow("no prepared candidate")
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
  const initial = {root: "/fixture", landingEntry: "first.js", fallbackEntry: "first.js"}
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
  f.cache.publish(checked)
  writeFileSync(f.path, "second")
  await f.cache.ensure()
  expect(() => f.cache.publish(checked)).toThrow("candidate changed")
  expect(f.cache.current().landingEntry).toBe("first.js")
  expect(f.updates).toEqual(["first.js"])
})

test("явный запрос полной среды собирает kernel после отдельного обновления Web", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-host-only-cache-"))
  cleanups.push(() => rmSync(root, {recursive: true, force: true}))
  const platform = join(root, "platform.ts")
  const web = join(root, "web.ts")
  writeFileSync(platform, "before")
  writeFileSync(web, "web-before")
  const digest = (value: string) => createHash("sha256").update(value).digest("hex")
  let builds = 0
  const cache = new StorybookSharedBrowserAssets({
    async build() {
      builds += 1
      const platformVersion = readFileSync(platform, "utf8")
      return {
        root,
        landingEntry: "page.js",
        fallbackEntry: "page.js",
        browserIdentity: Environment.identity(
          "/__storybook/shared/page.js",
          [{specifier: "@immersive/component", sourcePath: platform, url: `/__storybook/shared/kernel/${platformVersion}.js`}],
          digest(readFileSync(web, "utf8")),
        ),
      }
    },
    updated() {},
    failed() {},
  })
  try {
    const original = await cache.ensure()
    cache.publish()
    expect(builds).toBe(1)
    writeFileSync(platform, "after")
    writeFileSync(web, "web-after")
    const hostOnly = {
      ...original,
      browserIdentity: Environment.identity(
        "/__storybook/shared/updated-page.js",
        original.browserIdentity!.modules,
        digest(readFileSync(web, "utf8")),
      ),
    }
    cache.stageHost(hostOnly)
    const publishedHost = cache.publish(hostOnly)
    expect(publishedHost.browserIdentity?.epoch).toBe(original.browserIdentity?.epoch)
    const full = await cache.ensure()
    expect(builds).toBe(2)
    expect(full.browserIdentity?.epoch).not.toBe(original.browserIdentity?.epoch)
    expect(full.browserIdentity?.modules[0]?.url).toBe("/__storybook/shared/kernel/after.js")
    expect(cache.current()).toBe(publishedHost)
    expect(await cache.ensure()).not.toBe(full)
    expect(builds).toBe(3)
  } finally {
    await cache.dispose()
  }
})


test("изменение исходника во время успешной сборки не отменяет публикацию", async () => {
  const f = fixture()
  f.pause(async () => { writeFileSync(f.path, "next-edit") })
  const built = await f.cache.ensure()
  expect(built.landingEntry).toBe("first.js")
  expect(f.cache.publish().landingEntry).toBe("first.js")
  expect(f.errors).toEqual([])
  expect((await f.cache.ensure()).landingEntry).toBe("next-edit.js")
  expect(f.cache.publish().landingEntry).toBe("next-edit.js")
})
