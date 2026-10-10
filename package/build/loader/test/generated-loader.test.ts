import {describe, expect, test} from "bun:test"
import loader from "../index.ts"

const {
  generateAppliedRevisionLoaderSource: generateStorybookAppliedRevisionLoaderSource,
  generateLoaderSource: generateStorybookLoaderSource,
  generateRevisionPayloadSource: generateStorybookRevisionPayloadSource,
} = loader

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

  test("передаёт готовые JSX-конструкторы как props и именованный content без runtime автора", async () => {
    const jsx = {source: "<span>Контент</span>", imports: []}
    const scenario = {...component, variants: [{...component.variants[0]!,
      jsxProps: {badge: jsx}, slots: {default: jsx, footer: jsx}}]}
    const source = generateStorybookLoaderSource({revisionUrl, scenarios: [scenario]})
    const imported: string[] = []
    const constructors = new Map<string, Function>()
    const load = (url: string) => {
      imported.push(url)
      const Constructor = function ReadyComponent() {}
      constructors.set(url, Constructor)
      return Promise.resolve({Button: Constructor, ScenarioJsx: Constructor})
    }
    const loaders = new Function("importModule", source.replaceAll("export ", "").replaceAll("import(", "importModule(") +
      "\nreturn STORYBOOK_PACKAGE_SCENARIO_LOADERS")(load) as Map<string, () => Promise<{
      template: Function
      resolveProps(id: string, props: Record<string, unknown>): Record<string, unknown>
      resolveContent(id: string): Record<string, unknown>
    }>>
    expect(imported).toEqual([])
    const ready = await loaders.get(scenario.nodeId)!()
    expect(imported).toEqual(["/owner/component/index.tsx", "./scenario-jsx/0-0-0.tsx", "./scenario-jsx/0-0-1.tsx", "./scenario-jsx/0-0-2.tsx"])
    expect(constructors.has(imported[0]!)).toBe(true)
    expect(ready.template).toBe(constructors.get(imported[0]!)!)
    expect(ready.resolveProps("default", {name: "Button"})).toEqual({
      badge: {type: constructors.get(imported[1]!), props: {}}, name: "Button",
    })
    expect(ready.resolveContent("default")).toEqual({
      "": [{type: constructors.get(imported[2]!), props: {}}],
      footer: [{type: constructors.get(imported[3]!), props: {}}],
    })
    expect(ready.resolveContent("absent")).toEqual({})
    expect(source).not.toContain("@zavx0z/immersive/XReact")
    expect(source).not.toContain("slotContents")
    const modules = loader.generateJsxModules([scenario])
    expect(modules.map(module => module.path)).toEqual(imported.slice(1))
    expect(modules[2]!.source).toContain("return <span>Контент</span>")
    expect(modules[2]!.source).not.toContain("ScenarioSlot")
  })

  test("retries changed immutable revision URLs", () => {
    const first = generateStorybookLoaderSource({revisionUrl})
    const next = generateStorybookLoaderSource({revisionUrl: revisionUrl.replace("revision-a", "revision-b")})
    expect(first).not.toBe(next)
    expect(next).toContain("revision-b")
  })

  test("contentSource используется только для уже адресованных slot entries", () => {
    const jsx = {source: '<Badge slot="header" label="Заголовок" />', contentSource: '<Badge label="Заголовок" />', imports: []}
    const scenario = {...component, variants: [{...component.variants[0]!, jsxProps: {badge: jsx}, slots: {header: jsx}}]}
    const modules = loader.generateJsxModules([scenario])
    expect(modules).toHaveLength(2)
    expect(modules[0]!.source).toContain(`return ${jsx.source}`)
    expect(modules[1]!.source).toContain(`return ${jsx.contentSource}`)
    expect(modules[1]!.source).not.toContain('slot="header"')
    expect(modules[1]!.source).not.toContain("ScenarioSlot")
    expect(scenario.variants[0]!.slots.header.source).toBe(jsx.source)
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

  test("payload сохраняет платформу потребителя без закрепления общей оболочки", () => {
    const source = generateStorybookRevisionPayloadSource({packageId: "@fixture/components", candidateRevision: "revision-a",
      sharedModuleEpoch: "epoch", graphSnapshot: {protocol: "fixture"}})
    expect(source).toContain('sharedModuleEpoch: "epoch"')
    expect(source).not.toContain("startExternalStorybookPage")
    expect(source).not.toContain("startExternalStorybookPackage")
    expect(source).not.toContain("hostModuleEpoch")
  })
})
