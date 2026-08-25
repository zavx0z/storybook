import {describe, expect, test} from "bun:test"
import {
  normalizeStorybookBasePath,
  storybookBaseMetaName,
  storybookBasePath,
  storybookPublicPath,
  waitForStorybookFrameBoundary,
} from "./environment.ts"

function documentWithBase(appId: string, value: string): Document {
  return {
    querySelector(selector: string) {
      return selector === `meta[name="${appId}-storybook-base"]` ? {content: value} : null
    },
  } as unknown as Document
}

describe("Storybook public environment", () => {
  test("derives an app-specific meta contract without repository constants", () => {
    expect(storybookBaseMetaName("ui")).toBe("ui-storybook-base")
    expect(storybookBaseMetaName("node-editor")).toBe("node-editor-storybook-base")
    expect(() => storybookBaseMetaName("@ui/storybook")).toThrow("lowercase kebab-case")
  })

  test("keeps local development at the origin root", () => {
    const documentRef = documentWithBase("ui", "")
    expect(storybookBasePath("ui", documentRef)).toBe("")
    expect(storybookPublicPath("ui", "/elements/", documentRef)).toBe("/elements/")
  })

  test("mounts every public route below the app deployment base", () => {
    const documentRef = documentWithBase("ui", "/ui")
    expect(storybookBasePath("ui", documentRef)).toBe("/ui")
    expect(storybookPublicPath("ui", "/", documentRef)).toBe("/ui/")
    expect(storybookPublicPath("ui", "/components/", documentRef)).toBe("/ui/components/")
    expect(storybookPublicPath("ui", "/fonts/default.ttf", documentRef)).toBe("/ui/fonts/default.ttf")
  })

  test("rejects ambiguous mounts and public paths", () => {
    for (const value of ["ui", "/ui/", "/ui//docs", "/ui?mode=test"]) {
      expect(() => normalizeStorybookBasePath(value), value).toThrow()
    }
    const documentRef = documentWithBase("ui", "/ui")
    for (const pathname of ["components", "/components//button", "/components?mode=test"]) {
      expect(() => storybookPublicPath("ui", pathname, documentRef), pathname).toThrow()
    }
  })

  test("runs an already scheduled render before crossing the following frame boundary", async () => {
    const callbacks: FrameRequestCallback[] = []
    let rendered = false
    callbacks.push(() => { rendered = true })
    const boundary = waitForStorybookFrameBoundary((callback) => { callbacks.push(callback) })

    expect(callbacks).toHaveLength(2)
    const firstFrame = callbacks.splice(0)
    for (const callback of firstFrame) callback(1)
    expect(rendered).toBeTrue()
    expect(callbacks).toHaveLength(1)

    let complete = false
    void boundary.then(() => { complete = true })
    await Promise.resolve()
    expect(complete).toBeFalse()

    callbacks.shift()!(2)
    await boundary
    expect(complete).toBeTrue()
  })
})
