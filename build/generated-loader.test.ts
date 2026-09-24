import {describe, expect, test} from "bun:test"
import {
  generateStorybookAppliedRevisionLoaderSource,
  generateStorybookLoaderSource,
  generateStorybookRevisionPayloadSource,
} from "./generated-loader.ts"

const revisionUrl = "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/"
const component = {nodeId: "directory:package:@fixture/components/button", kind: "component" as const,
  module: {path: "/owner/component/index.tsx", export: "Button"},
  variants: [{id: "default", title: "Default", props: {name: "Button"}, source: "<Button />", points: []}]}
const operation = {nodeId: "directory:package:@fixture/components/action", kind: "function" as const,
  variants: [{id: "example", title: "Example", source: "action()", calls: [], points: []}]}

describe("generated structural scenario loader", () => {
  test("emits literal component import and data-only function scenario", () => {
    const source = generateStorybookLoaderSource({revisionUrl, scenarios: [component, operation]})
    expect(source).toContain('import("/owner/component/index.tsx")')
    expect(source).toContain('namespace["Button"]')
    expect(source).toContain('kind: "function"')
    expect(source).toContain("STORYBOOK_PACKAGE_SCENARIO_LOADERS")
    expect(source).not.toContain("runtime.ts")
  })

  test("sorts scenarios regardless of discovery order", () => {
    expect(generateStorybookLoaderSource({revisionUrl, scenarios: [component, operation]}))
      .toBe(generateStorybookLoaderSource({revisionUrl, scenarios: [operation, component]}))
  })

  test("retries changed immutable revision URLs", () => {
    const first = generateStorybookLoaderSource({revisionUrl})
    const next = generateStorybookLoaderSource({revisionUrl: revisionUrl.replace("revision-a", "revision-b")})
    expect(first).not.toBe(next)
    expect(next).toContain("revision-b")
  })

  test("rejects unsafe imports, duplicate nodes and malformed scenario data", () => {
    expect(() => generateStorybookLoaderSource({revisionUrl: "/bad/"})).toThrow("revision URL")
    expect(() => generateStorybookLoaderSource({revisionUrl, scenarios: [component, component]})).toThrow("Duplicate Storybook scenario node")
    expect(() => generateStorybookLoaderSource({revisionUrl, scenarios: [{...component, module: {path: "../escape.tsx", export: "Button"}}]})).toThrow("module path")
    expect(() => generateStorybookLoaderSource({revisionUrl, scenarios: [{...component, variants: [{...component.variants[0]!, props: null as never}]}]})).toThrow("props")
  })

  test("generates an immutable page payload with only scenario loaders", () => {
    const source = generateStorybookRevisionPayloadSource({packageId: "@fixture/components", candidateRevision: "revision-a",
      sharedModuleEpoch: "epoch", graphSnapshot: {protocol: "fixture"}})
    expect(source).toContain("STORYBOOK_PACKAGE_SCENARIO_LOADERS")
    expect(source).toContain("graphSnapshot")
    expect(source).not.toContain("storyLoaders")
    expect(source).not.toContain("widgetLoaders")
    expect(source).not.toContain("loadRuntime")
  })

  test("bounds the browser importer to one package and revision", () => {
    const source = generateStorybookAppliedRevisionLoaderSource("@fixture/components")
    expect(source).toContain("/__storybook/revisions/%40fixture%2Fcomponents/")
    expect(source).toContain("revision-payload.js")
    expect(source).toContain("signal.throwIfAborted()")
  })
})
