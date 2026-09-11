import {describe, expect, test} from "bun:test"
import {
  generateStorybookLoaderSource,
  generateStorybookAppliedRevisionLoaderSource,
  generateStorybookRevisionPayloadSource,
} from "./generated-loader.ts"

const runtime = Object.freeze({path: "/owner/package/.storybook/runtime.ts", export: "runtime"})

describe("external Storybook generated loader", () => {
  test("emits one literal runtime import and one literal import per sorted variant", () => {
    const source = generateStorybookLoaderSource({
      revisionUrl: "/__storybook/revisions/ui-components/rev-a/",
      runtime,
      variants: [
        {
          route: "foundation/button/basic/outlined",
          module: {path: "/owner/package/.storybook/stories/button outlined.ts", export: "outlined"},
        },
        {
          route: "foundation/button/basic/contained",
          module: {path: "/owner/package/.storybook/stories/button.ts", export: "contained"},
        },
      ],
      widgets: [],
    })

    expect(source.match(/\bimport\("[^"\n]+"\)/gu)).toHaveLength(3)
    expect(source).toContain(
      'import("/owner/package/.storybook/runtime.ts")',
    )
    expect(source).toContain(
      'import("/owner/package/.storybook/stories/button outlined.ts")',
    )
    expect(source).toContain("export function loadStorybookPackageRuntime()")
    expect(source).toContain("export const STORYBOOK_PACKAGE_STORY_LOADERS = new Map([")
    expect(source.indexOf("contained")).toBeLessThan(source.indexOf("outlined"))
    expect(source).not.toMatch(/\bimport\((?:route|path|module)/u)
    expect(source).not.toContain("eval")
    expect(source).not.toContain("new Function")
  })

  test("is deterministic regardless of discovery order", () => {
    const variants = [
      {route: "zeta/story/default", module: {path: "/owner/zeta.ts", export: "story"}},
      {route: "alpha/story/default", module: {path: "/owner/alpha.ts", export: "story"}},
    ] as const
    const first = generateStorybookLoaderSource({
      revisionUrl: "/__storybook/revisions/example/rev-a/",
      runtime,
      variants,
      widgets: [],
    })
    const second = generateStorybookLoaderSource({
      revisionUrl: "/__storybook/revisions/example/rev-a/",
      runtime,
      variants: [...variants].reverse(),
      widgets: [],
    })

    expect(first).toBe(second)
  })

  test("uses a new immutable revision URL to retry previously failed imports", () => {
    const input = {
      runtime,
      variants: [{
        route: "foundation/button/default",
        module: {path: "/owner/stories/button.ts", export: "story"},
      }],
      widgets: [],
    } as const
    const oldSource = generateStorybookLoaderSource({
      ...input,
      revisionUrl: "/__storybook/revisions/example/rev-failed/",
    })
    const fixedSource = generateStorybookLoaderSource({
      ...input,
      revisionUrl: "/__storybook/revisions/example/rev-fixed/",
    })

    expect(oldSource).toContain('storybookRevisionUrl = "/__storybook/revisions/example/rev-failed/"')
    expect(fixedSource).toContain('storybookRevisionUrl = "/__storybook/revisions/example/rev-fixed/"')
    expect(fixedSource).not.toContain("/rev-failed/")
    expect(fixedSource).not.toBe(oldSource)
  })

  test("fails closed before emitting unsafe paths, exports or route identities", () => {
    const valid = {
      revisionUrl: "/__storybook/revisions/example/rev-a/",
      runtime,
      variants: [],
      widgets: [],
    } as const
    for (const input of [null, [], {...valid, variants: null}]) {
      expect(() => generateStorybookLoaderSource(
        input as unknown as Parameters<typeof generateStorybookLoaderSource>[0],
      )).toThrow()
    }
    for (const revisionUrl of [
      "https://example.com/rev/",
      "/",
      "/revision/../escape/",
      "/revision/value/?candidate=1",
    ]) expect(() => generateStorybookLoaderSource({...valid, revisionUrl})).toThrow()

    for (const path of ["../runtime.ts", "runtime.ts", "/runtime.ts?next", "/dir\\runtime.ts"]) {
      expect(() => generateStorybookLoaderSource({
        ...valid,
        runtime: {path, export: "runtime"},
      })).toThrow()
    }

    expect(() => generateStorybookLoaderSource({
      ...valid,
      runtime: {path: "/owner/runtime.ts", export: "runtime);alert(1)"},
    })).toThrow()
    expect(() => generateStorybookLoaderSource({
      ...valid,
      variants: [{
        route: "__proto__",
        module: {path: "/owner/story.ts", export: "story"},
      }],
    })).toThrow()
    expect(() => generateStorybookLoaderSource({
      ...valid,
      variants: [
        {route: "story/default", module: {path: "/owner/one.ts", export: "story"}},
        {route: "story/default", module: {path: "/owner/two.ts", export: "story"}},
      ],
    })).toThrow("Duplicate Storybook variant route")
  })

  test("emits exact lazy component widget loaders by contribution id", () => {
    const source = generateStorybookLoaderSource({
      revisionUrl: "/__storybook/revisions/example/rev-widgets/",
      runtime: null,
      variants: [],
      widgets: [{
        id: "package-inspector",
        module: {path: "/owner/widgets/inspector.tsx", export: "InspectorWidget"},
      }],
    })

    expect(source).toContain("STORYBOOK_PACKAGE_WIDGET_LOADERS = new Map")
    expect(source).toContain('"package-inspector"')
    expect(source).toContain('import("/owner/widgets/inspector.tsx")')
    expect(source).toContain('namespace["InspectorWidget"]')
    expect(source).toContain("const runtimeLoader = null")
    expect(source).toContain("export const loadStorybookPackageRuntime = null")
    expect(source).toContain("export function loadStorybookWidget(id)")
  })

  test("генерирует exact page-realm revision payload без side effects", () => {
    const source = generateStorybookRevisionPayloadSource({
      packageId: "@fixture/package",
      candidateRevision: "revision-a",
      sharedModuleEpoch: "shared-a",
      hostModuleEpoch: "host-a",
      graphSnapshot: {protocol: "storybook-package-graph/1"},
    })

    expect(source).toContain("export const STORYBOOK_APPLIED_REVISION")
    expect(source).toContain('protocol: "storybook-page-realm/1"')
    expect(source).toContain('sharedModuleEpoch: "shared-a"')
    expect(source).toContain('hostModuleEpoch: "host-a"')
    expect(source).toContain("storyLoaders: STORYBOOK_PACKAGE_STORY_LOADERS")
    expect(source).not.toContain("startExternalStorybookPackage")
    expect(source).not.toMatch(/\bdocument\b|\bwindow\b|\blocation\b/u)
  })

  test("генерирует bounded importer immutable ревизии без URL от сервера", () => {
    const source = generateStorybookAppliedRevisionLoaderSource("@fixture/package")

    expect(source).toContain('const url = "/__storybook/revisions/%40fixture%2Fpackage/" + revision + "/revision-payload.js"')
    expect(source).toContain("const namespace = await import(url)")
    expect(source).toContain("signal.throwIfAborted()")
    expect(source).toContain('payload.protocol !== "storybook-page-realm/1"')
    expect(source).not.toContain("revisionUrl")
    expect(source).not.toContain("fetch(")
  })
})
