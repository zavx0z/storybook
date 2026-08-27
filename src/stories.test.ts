import {describe, expect, test} from "bun:test"
import {
  defineStorybookStories,
  defineStorybookStoryModule,
  storyRoute,
  type StorybookStoryControlInput,
  type StorybookStoryModule,
} from "./stories.ts"

const module = defineStorybookStoryModule({
  defaultArgs: {label: "Основная", disabled: false, variant: "contained"},
  controls: [
    {key: "label", label: "Подпись", group: "Основные", kind: "text", interactive: false},
    {key: "disabled", label: "Недоступна", group: "Состояние", kind: "boolean"},
    {
      key: "variant",
      label: "Вариант",
      group: "Основные",
      kind: "select",
      options: [
        {value: "", label: "Без варианта"},
        {value: "text", label: "Текстовая"},
        {value: "contained", label: "Заполненная"},
      ],
    },
  ],
  render() {},
  source(args) {
    return {
      html: `<button class="button">${args.label}</button>`,
      css: `.button { display: inline-flex; }`,
      typescript: `Button(surface, x, y, w, h, {children: ${JSON.stringify(args.label)}, variant: ${JSON.stringify(args.variant)}})`,
    }
  },
})

function catalog(load: () => Promise<StorybookStoryModule>) {
  return defineStorybookStories({
    groups: [{
      id: "basic",
      label: "Основные",
      components: [{
        id: "button",
        label: "Кнопка",
        apiName: "Button",
        tags: ["action", "действие"],
        sections: [{
          id: "basic",
          label: "Основное",
          variants: [{
            id: "contained",
            label: "Заполненная",
            title: "Заполненная кнопка",
            tags: ["primary"],
            load,
          }],
        }],
      }],
    }],
    representative: {component: "button", section: "basic", variant: "contained"},
  })
}

describe("typed Storybook story registry", () => {
  test("keeps metadata eager and representative separate from routing", () => {
    let loads = 0
    const registry = catalog(async () => {
      loads += 1
      return module
    })
    expect(registry.representative).toBe("button/basic/contained")
    expect(registry.routeTree.overviews).toEqual(["", "button", "button/basic"])
    expect(registry.index).toEqual([{
      route: "button/basic/contained",
      groupId: "basic",
      groupLabel: "Основные",
      componentId: "button",
      componentLabel: "Кнопка",
      apiName: "Button",
      sectionId: "basic",
      sectionLabel: "Основное",
      variantId: "contained",
      variantLabel: "Заполненная",
      title: "Заполненная кнопка",
      tags: ["action", "действие", "primary"],
      searchText: "основные кнопка button основное заполненная заполненная кнопка action действие primary",
    }])
    expect(registry.find("button/basic/contained")).toBe(registry.index[0])
    expect(registry.find("missing")).toBeUndefined()
    expect(registry.variants("button/basic/contained")).toEqual(registry.index)
    expect(registry.variants("missing")).toEqual([])
    expect("fallback" in registry).toBeFalse()
    expect("declaration" in registry).toBeFalse()
    expect(Object.isFrozen(registry)).toBeTrue()
    expect(Object.isFrozen(registry.index)).toBeTrue()
    expect(loads).toBe(0)
  })

  test("marks only boolean and select controls interactive", () => {
    expect(module.controls.map(({kind, interactive}) => [kind, interactive])).toEqual([
      ["text", false],
      ["boolean", true],
      ["select", true],
    ])
    expect("play" in module).toBeFalse()

    const unsafeControl = {
      key: "label",
      label: "Подпись",
      group: "Основные",
      kind: "text",
    } as unknown as StorybookStoryControlInput<"label">
    expect(() => defineStorybookStoryModule({
      defaultArgs: {label: "Основная"},
      controls: [unsafeControl],
      render() {},
      source: () => ({html: "<p>source</p>", css: "p {}", typescript: "source"}),
    })).toThrow("must be explicitly noninteractive")
  })

  test("loads one story lazily and caches the exact promise", async () => {
    let loads = 0
    const registry = catalog(async () => {
      loads += 1
      return module
    })
    const first = registry.load("button/basic/contained")
    const second = registry.load("button/basic/contained")
    expect(second).toBe(first)
    expect(await first).toBe(module)
    expect(loads).toBe(1)
    const source = module.source({...module.defaultArgs, label: "Готово"})
    expect(source.html).toContain("Готово")
    expect(source.css).toContain(".button")
    expect(source.typescript).toContain('"Готово"')
    expect(Object.isFrozen(source)).toBeTrue()
  })

  test("requires and snapshots literal HTML, CSS and TypeScript source", () => {
    const mutable = {html: "<div></div>", css: "div {}", typescript: "div(surface, x, y, w, h)"}
    const valid = defineStorybookStoryModule({
      defaultArgs: {},
      render() {},
      source: () => mutable,
    })
    const source = valid.source({})
    mutable.html = "<span></span>"
    expect(source).toEqual({
      html: "<div></div>",
      css: "div {}",
      typescript: "div(surface, x, y, w, h)",
    })
    expect(Object.isFrozen(source)).toBeTrue()

    for (const kind of ["html", "css", "typescript"] as const) {
      const invalid = defineStorybookStoryModule({
        defaultArgs: {},
        render() {},
        source: () => ({...source, [kind]: "  "}),
      })
      expect(() => invalid.source({})).toThrow(`source ${kind} must not be empty`)
    }
  })

  test("retries a failed lazy story", async () => {
    let attempts = 0
    const registry = catalog(async () => {
      attempts += 1
      if (attempts === 1) throw new Error("temporary")
      return module
    })
    await expect(registry.load("button/basic/contained")).rejects.toThrow("temporary")
    expect(await registry.load("button/basic/contained")).toBe(module)
    expect(attempts).toBe(2)
  })

  test("rejects unknown representatives, ambiguous hierarchy and invalid modules", async () => {
    expect(() => storyRoute({component: "Button", section: "basic", variant: "contained"})).toThrow()
    expect(() => defineStorybookStories({
      groups: [{id: "empty", label: "Пусто", components: []}],
      representative: {component: "button", section: "basic", variant: "contained"},
    })).toThrow("has no components")
    expect(() => defineStorybookStories({
      groups: [{
        id: "basic",
        label: "Основные",
        components: [{
          id: "button",
          label: "Кнопка",
          apiName: "Button",
          sections: [{
            id: "basic",
            label: "Основное",
            variants: [{id: "contained", label: "Заполненная", title: "Заполненная", load: async () => module}],
          }],
        }],
      }],
      representative: {component: "button", section: "basic", variant: "missing"},
    })).toThrow("representative route is not registered")

    const invalid = catalog(async () => ({defaultArgs: {}, controls: [], render() {}} as unknown as StorybookStoryModule))
    await expect(invalid.load("button/basic/contained")).rejects.toThrow("source must be a function")
    await expect(invalid.load("missing")).rejects.toThrow("Unknown storybook story route")
  })
})
