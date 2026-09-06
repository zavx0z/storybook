import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync, statSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {PNG} from "pngjs"
import {StorybookCaptureStore} from "./capture-store.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook capture store", () => {
  test("stores a bounded PNG artifact without exposing its filesystem path", () => {
    const root = temporaryRoot()
    const store = new StorybookCaptureStore({root})
    const capture = store.put(png(3, 2), metadata("revision-a"))
    expect(capture).toMatchObject({
      mimeType: "image/png",
      width: 3,
      height: 2,
      packageId: "@fixture/a",
      revision: "revision-a",
    })
    expect(capture.resourceUri).toBe(`storybook://captures/${capture.captureId}`)
    expect(JSON.stringify(capture)).not.toContain(root)
    const read = store.read(capture.captureId)
    expect(read.metadata.sha256).toBe(capture.sha256)
    expect(read.png).toEqual(png(3, 2))
    expect(statSync(join(root, `${capture.captureId}.png`)).mode & 0o777).toBe(0o600)
  })

  test("collects expired and excess captures", () => {
    const root = temporaryRoot()
    let now = 1_000
    const store = new StorybookCaptureStore({root, maxEntries: 1, ttlMs: 100, now: () => now})
    const first = store.put(png(1, 1), metadata("revision-a"))
    now += 10
    const second = store.put(png(1, 1), metadata("revision-b"))
    expect(store.list().map(({captureId}) => captureId)).toEqual([second.captureId])
    expect(() => store.read(first.captureId)).toThrow("Unknown Storybook capture")
    now += 101
    store.collect()
    expect(store.list()).toEqual([])
  })
})

function metadata(revision: string) {
  return {
    packageId: "@fixture/a",
    route: "fixture/a/default",
    graphDigest: "a".repeat(64),
    revision,
    area: "preview" as const,
    consoleErrors: [],
  }
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-capture-store-"))
  roots.push(root)
  return root
}

function png(width: number, height: number): Uint8Array {
  const image = new PNG({width, height})
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const pixel = offset / 4
    image.data[offset] = pixel % 2 === 0 ? 24 : 220
    image.data[offset + 1] = 80
    image.data[offset + 2] = 160
    image.data[offset + 3] = 255
  }
  return new Uint8Array(PNG.sync.write(image))
}
