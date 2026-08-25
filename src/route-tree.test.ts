import {describe, expect, test} from "bun:test"
import {
  StorybookRouteTreeNotFoundError,
  StorybookRouteTreeRouter,
  defineStorybookRouteTree,
  resolveStorybookRouteTree,
  storybookRouteTreeUrl,
} from "./route-tree.ts"

const leaves = [
  "button/basic/contained",
  "button/basic/text",
  "input/state/default",
] as const
const tree = defineStorybookRouteTree({leaves})

describe("typed Storybook route tree", () => {
  test("derives root and proper-prefix overviews in source order", () => {
    expect(tree.leaves).toEqual(leaves)
    expect(tree.overviews).toEqual(["", "button", "button/basic", "input", "input/state"])
    expect(tree.children("").map(({kind, path}) => [kind, path])).toEqual([
      ["overview", "button"],
      ["overview", "input"],
    ])
    expect(tree.children("button/basic").map(({kind, path}) => [kind, path])).toEqual([
      ["leaf", "button/basic/contained"],
      ["leaf", "button/basic/text"],
    ])
    expect(tree.find("/button/basic/")).toBe(tree.find("button/basic"))
    expect(Object.isFrozen(tree)).toBeTrue()
    expect(Object.isFrozen(tree.nodes)).toBeTrue()
    expect(Object.isFrozen(tree.children("button/basic"))).toBeTrue()
  })

  test("supports an overview-only app and rejects ambiguous leaves", () => {
    const overviewOnly = defineStorybookRouteTree({leaves: [] as const})
    expect(overviewOnly.nodes).toEqual([{
      kind: "overview",
      path: "",
      segment: "",
      parentPath: null,
      depth: 0,
    }])
    expect(overviewOnly.children("")).toEqual([])
    expect(() => overviewOnly.children("missing")).toThrow("Unknown storybook route tree node")

    expect(() => defineStorybookRouteTree({leaves: ["a", "a"] as const}))
      .toThrow("leaves must be unique")
    expect(() => defineStorybookRouteTree({leaves: ["a", "a/b"] as const}))
      .toThrow("leaf cannot contain another leaf")
    expect(() => defineStorybookRouteTree({leaves: ["a/b", "a"] as const}))
      .toThrow("leaf conflicts with overview")
    for (const leaf of ["", "/a", "a/", "a//b", "a?b", "a#b"]) {
      expect(() => defineStorybookRouteTree({leaves: [leaf]}), leaf)
        .toThrow("must be a normalized pathname id")
    }
  })

  test("uses trailing slash only for overview nodes", () => {
    expect(storybookRouteTreeUrl(tree, "", {basePath: "/ui"})).toBe("/ui/")
    expect(storybookRouteTreeUrl(tree, "button", {basePath: "/ui"})).toBe("/ui/button/")
    expect(storybookRouteTreeUrl(tree, "button/basic", {basePath: "/ui/"})).toBe("/ui/button/basic/")
    expect(storybookRouteTreeUrl(tree, "button/basic/contained", {basePath: "ui"}))
      .toBe("/ui/button/basic/contained")
    expect(storybookRouteTreeUrl(tree, "", {basePath: "/"})).toBe("/")
    expect(() => storybookRouteTreeUrl(tree, "missing", {basePath: "/ui"}))
      .toThrow("Unknown storybook route tree node")
  })

  test("resolves compatible slash forms to one canonical pathname", () => {
    const cases = [
      ["/ui", "overview", "", "/ui/", true],
      ["/ui/", "overview", "", "/ui/", false],
      ["/ui/button", "overview", "button", "/ui/button/", true],
      ["/ui/button/", "overview", "button", "/ui/button/", false],
      ["/ui/button/basic/contained", "leaf", "button/basic/contained", "/ui/button/basic/contained", false],
      ["/ui/button/basic/contained/", "leaf", "button/basic/contained", "/ui/button/basic/contained", true],
    ] as const
    for (const [pathname, kind, path, canonicalPath, redirect] of cases) {
      const resolved = resolveStorybookRouteTree(tree, {pathname}, {basePath: "/ui"})
      expect(resolved.kind, pathname).toBe("match")
      if (resolved.kind !== "match") throw new Error(`Expected route match: ${pathname}`)
      expect(resolved.node.kind, pathname).toBe(kind)
      expect(resolved.node.path, pathname).toBe(path)
      expect(resolved.canonicalPath, pathname).toBe(canonicalPath)
      expect(resolved.redirect, pathname).toBe(redirect)
    }
  })

  test("fails closed for unknown, malformed and foreign paths", () => {
    for (const pathname of [
      "/ui/missing",
      "/ui/button/missing",
      "/ui/button/basic/contained/extra",
      "/ui//button/basic/contained",
      "/ui-other/button/basic/contained",
      "/other/button/basic/contained",
      "/button/basic/contained",
      "ui/button/basic/contained",
      "/ui/button/basic/contained?mode=test",
      "/ui/button/basic/contained#source",
    ]) {
      expect(resolveStorybookRouteTree(tree, {pathname}, {basePath: "/ui"}), pathname)
        .toEqual({kind: "not-found"})
    }
  })

  test("owns one mounted browser history without falling back on unknown locations", () => {
    withBrowser("/ui/button", ({pushed, replaced, navigate}) => {
      const notFound: string[] = []
      const router = new StorybookRouteTreeRouter(tree, {
        basePath: "/ui",
        onNotFound: (error) => notFound.push(error.pathname),
      })

      expect(router.current).toMatchObject({kind: "overview", path: "button"})
      expect(replaced).toEqual(["/ui/button/"])
      expect(router.go("button/basic/contained")).toBeTrue()
      expect(pushed).toEqual(["/ui/button/basic/contained"])
      expect(router.go("missing")).toBeFalse()

      navigate("/ui/button/basic/text/")
      expect(replaced.at(-1)).toBe("/ui/button/basic/text")
      navigate("/ui/missing")
      expect(notFound).toEqual(["/ui/missing"])
      expect(router.current).toMatchObject({kind: "leaf", path: "button/basic/text"})

      router.dispose()
      navigate("/ui/")
      expect(router.current).toMatchObject({kind: "leaf", path: "button/basic/text"})
    })

    withBrowser("/ui/missing", () => {
      expect(() => new StorybookRouteTreeRouter(tree, {basePath: "/ui"}))
        .toThrow(StorybookRouteTreeNotFoundError)
    })
  })
})

type BrowserHarness = Readonly<{
  pushed: string[]
  replaced: string[]
  navigate(pathname: string): void
}>

function withBrowser(pathname: string, run: (harness: BrowserHarness) => void): void {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
  const historyDescriptor = Object.getOwnPropertyDescriptor(globalThis, "history")
  const listeners = new Set<() => void>()
  const location = {pathname}
  const pushed: string[] = []
  const replaced: string[] = []
  const browserWindow = {
    location,
    addEventListener(type: string, listener: () => void) {
      if (type === "popstate") listeners.add(listener)
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === "popstate") listeners.delete(listener)
    },
  }
  const browserHistory = {
    pushState(_data: unknown, _unused: string, url: string | URL | null) {
      if (url === null) return
      const next = String(url)
      pushed.push(next)
      location.pathname = next
    },
    replaceState(_data: unknown, _unused: string, url: string | URL | null) {
      if (url === null) return
      const next = String(url)
      replaced.push(next)
      location.pathname = next
    },
  }

  Object.defineProperty(globalThis, "window", {configurable: true, value: browserWindow})
  Object.defineProperty(globalThis, "history", {configurable: true, value: browserHistory})
  try {
    run({
      pushed,
      replaced,
      navigate(nextPathname) {
        location.pathname = nextPathname
        for (const listener of [...listeners]) listener()
      },
    })
  } finally {
    restoreGlobal("window", windowDescriptor)
    restoreGlobal("history", historyDescriptor)
  }
}

function restoreGlobal(name: "window" | "history", descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) delete (globalThis as unknown as Record<string, unknown>)[name]
  else Object.defineProperty(globalThis, name, descriptor)
}
