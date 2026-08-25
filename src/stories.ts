/**
Eager Storybook catalog metadata and lazy repository-owned story modules.

The registry indexes owner descriptors without importing their implementations.
Unknown routes remain unknown; `representative` is presentation state for an
overview, never a routing fallback.

@packageDocumentation
*/

import type {UiSurfaceRect} from "@layout/core/runtime"
import type {UiSurface} from "@layout/core/surface"
import {defineStorybookRouteTree, type StorybookRouteTree} from "./route-tree.ts"

export type StorybookStoryArgs = Readonly<Record<string, unknown>>

export type StorybookStoryInteractiveControlKind = "boolean" | "select"
export type StorybookStoryNonInteractiveControlKind = "number" | "text" | "color" | "custom"
export type StorybookStoryControlKind =
  | StorybookStoryInteractiveControlKind
  | StorybookStoryNonInteractiveControlKind

export type StorybookStoryControlOption = Readonly<{
  value: string
  label: string
}>

type StorybookStoryControlBase<Key extends string> = Readonly<{
  key: Key
  label: string
  group: string
  description?: string
}>

export type StorybookStoryBooleanControl<Key extends string = string> = Readonly<
  StorybookStoryControlBase<Key> & {
    kind: "boolean"
    interactive: true
    options?: never
  }
>

export type StorybookStorySelectControl<Key extends string = string> = Readonly<
  StorybookStoryControlBase<Key> & {
    kind: "select"
    interactive: true
    options: readonly StorybookStoryControlOption[]
  }
>

/**
A visible control whose current shared Workbench deliberately cannot mutate it.

The explicit `interactive: false` prevents descriptive control kinds from
silently acquiring behavior that their renderer does not implement.
*/
export type StorybookStoryNonInteractiveControl<Key extends string = string> = Readonly<
  StorybookStoryControlBase<Key> & {
    kind: StorybookStoryNonInteractiveControlKind
    interactive: false
    options?: never
  }
>

export type StorybookStoryControl<Key extends string = string> =
  | StorybookStoryBooleanControl<Key>
  | StorybookStorySelectControl<Key>
  | StorybookStoryNonInteractiveControl<Key>

export type StorybookStoryControlInput<Key extends string = string> =
  | Readonly<StorybookStoryControlBase<Key> & {
      kind: "boolean"
      interactive?: true
      options?: never
    }>
  | Readonly<StorybookStoryControlBase<Key> & {
      kind: "select"
      interactive?: true
      options: readonly StorybookStoryControlOption[]
    }>
  | StorybookStoryNonInteractiveControl<Key>

export type StorybookStoryModuleInput<Args extends StorybookStoryArgs> = Readonly<{
  defaultArgs: Args
  controls?: readonly StorybookStoryControlInput<Extract<keyof Args, string>>[]
  render(surface: UiSurface, args: Args, frame: UiSurfaceRect): void
  source(args: Args): string
}>

/** A loaded story keeps only production rendering and source-generation behavior. */
export type StorybookStoryModule = Readonly<{
  defaultArgs: StorybookStoryArgs
  controls: readonly StorybookStoryControl[]
  render(surface: UiSurface, args: StorybookStoryArgs, frame: UiSurfaceRect): void
  source(args: StorybookStoryArgs): string
}>

export type StorybookStoryLoader = () => Promise<StorybookStoryModule>

export type StorybookStoryVariantInput = Readonly<{
  id: string
  label: string
  title: string
  tags?: readonly string[]
  load: StorybookStoryLoader
}>

export type StorybookStorySectionInput = Readonly<{
  id: string
  label: string
  variants: readonly StorybookStoryVariantInput[]
}>

export type StorybookStoryComponentInput = Readonly<{
  id: string
  label: string
  apiName: string
  tags?: readonly string[]
  sections: readonly StorybookStorySectionInput[]
}>

export type StorybookStoryGroupInput = Readonly<{
  id: string
  label: string
  components: readonly StorybookStoryComponentInput[]
}>

export type StorybookStoryPath = Readonly<{
  component: string
  section: string
  variant: string
}>

export type StorybookStoryCatalogInput = Readonly<{
  groups: readonly StorybookStoryGroupInput[]
  /** Detail shown by an overview before the owner makes a more local choice. */
  representative: StorybookStoryPath
}>

export type StorybookStoryIndexItem = Readonly<{
  route: string
  groupId: string
  groupLabel: string
  componentId: string
  componentLabel: string
  apiName: string
  sectionId: string
  sectionLabel: string
  variantId: string
  variantLabel: string
  title: string
  tags: readonly string[]
  searchText: string
}>

/**
Eager metadata plus a per-route lazy module cache.

A rejected load is removed from the cache so a transient failure does not
poison later owner-controlled retries.
*/
export type StorybookStoryRegistry = Readonly<{
  routeTree: StorybookRouteTree<string>
  index: readonly StorybookStoryIndexItem[]
  representative: string
  find(route: string): StorybookStoryIndexItem | undefined
  variants(route: string): readonly StorybookStoryIndexItem[]
  load(route: string): Promise<StorybookStoryModule>
}>

type InternalStory = Readonly<{
  index: StorybookStoryIndexItem
  load: StorybookStoryLoader
}>

/**
Normalizes one repository-owned story implementation.

`defaultArgs` and controls are shallow snapshots. The production owner retains
the render target and implementation; this package only enforces the shared
module boundary and non-empty generated source.

@throws If a control is malformed or `source()` later returns only whitespace.
*/
export function defineStorybookStoryModule<const Args extends StorybookStoryArgs>(
  input: StorybookStoryModuleInput<Args>,
): StorybookStoryModule {
  const defaultArgs = Object.freeze({...input.defaultArgs})
  const controls = Object.freeze((input.controls ?? []).map((control) => normalizeControl(control)))
  const module: StorybookStoryModule = {
    defaultArgs,
    controls,
    render(surface, args, frame) {
      input.render(surface, args as Args, frame)
    },
    source(args) {
      const source = input.source(args as Args)
      if (source.trim().length === 0) throw new Error("Storybook story source must not be empty")
      return source
    },
  }
  return Object.freeze(module)
}

/**
Flattens owner descriptors into an eager searchable index and lazy module cache.

`representative` must name a real leaf, but it is not consulted by `find()` or
`load()`. Consumers therefore cannot turn an unknown pathname into a story.

@throws If hierarchy metadata is malformed, duplicated or empty, or if the
representative leaf is not registered.
*/
export function defineStorybookStories(input: StorybookStoryCatalogInput): StorybookStoryRegistry {
  if (input.groups.length === 0) throw new Error("Storybook story catalog must contain at least one group")
  const stories: InternalStory[] = []
  const groupIds = new Set<string>()
  const componentIds = new Set<string>()

  for (const group of input.groups) {
    validateId("group", group.id)
    validateLabel("group", group.label)
    if (groupIds.has(group.id)) throw new Error(`Duplicate storybook story group: ${group.id}`)
    groupIds.add(group.id)
    if (group.components.length === 0) throw new Error(`Storybook story group has no components: ${group.id}`)

    for (const component of group.components) {
      validateId("component", component.id)
      validateLabel("component", component.label)
      validateLabel("component apiName", component.apiName)
      if (componentIds.has(component.id)) throw new Error(`Duplicate storybook story component: ${component.id}`)
      componentIds.add(component.id)
      if (component.sections.length === 0) {
        throw new Error(`Storybook story component has no sections: ${component.id}`)
      }
      const sectionIds = new Set<string>()

      for (const section of component.sections) {
        validateId("section", section.id)
        validateLabel("section", section.label)
        if (sectionIds.has(section.id)) {
          throw new Error(`Duplicate storybook story section: ${component.id}/${section.id}`)
        }
        sectionIds.add(section.id)
        if (section.variants.length === 0) {
          throw new Error(`Storybook story section has no variants: ${component.id}/${section.id}`)
        }
        const variantIds = new Set<string>()

        for (const variant of section.variants) {
          validateId("variant", variant.id)
          validateLabel("variant", variant.label)
          validateLabel("story title", variant.title)
          if (variantIds.has(variant.id)) {
            throw new Error(`Duplicate storybook story variant: ${component.id}/${section.id}/${variant.id}`)
          }
          variantIds.add(variant.id)
          if (typeof variant.load !== "function") throw new Error("Storybook story loader must be a function")
          const route = storyRoute({component: component.id, section: section.id, variant: variant.id})
          const tags = Object.freeze(uniqueStrings([...(component.tags ?? []), ...(variant.tags ?? [])]))
          const index: StorybookStoryIndexItem = Object.freeze({
            route,
            groupId: group.id,
            groupLabel: group.label,
            componentId: component.id,
            componentLabel: component.label,
            apiName: component.apiName,
            sectionId: section.id,
            sectionLabel: section.label,
            variantId: variant.id,
            variantLabel: variant.label,
            title: variant.title,
            tags,
            searchText: normalizeSearch([
              group.label,
              component.label,
              component.apiName,
              section.label,
              variant.label,
              variant.title,
              ...tags,
            ]),
          })
          stories.push(Object.freeze({index, load: variant.load}))
        }
      }
    }
  }

  const routes = Object.freeze(stories.map(({index}) => index.route))
  const routeTree = defineStorybookRouteTree({leaves: routes})
  const byRoute = new Map(stories.map((story) => [story.index.route, story]))
  const representative = storyRoute(input.representative)
  if (!byRoute.has(representative)) {
    throw new Error(`Storybook representative route is not registered: ${representative}`)
  }
  const loaded = new Map<string, Promise<StorybookStoryModule>>()
  const index = Object.freeze(stories.map((story) => story.index))
  const noVariants = Object.freeze([]) as readonly StorybookStoryIndexItem[]

  return Object.freeze({
    routeTree,
    index,
    representative,
    find(route: string) {
      return byRoute.get(route)?.index
    },
    variants(route: string) {
      const selected = byRoute.get(route)?.index
      if (selected === undefined) return noVariants
      return Object.freeze(index.filter((item) =>
        item.componentId === selected.componentId && item.sectionId === selected.sectionId))
    },
    load(route: string) {
      const story = byRoute.get(route)
      if (story === undefined) return Promise.reject(new Error(`Unknown storybook story route: ${route}`))
      const current = loaded.get(route)
      if (current !== undefined) return current
      const pending = story.load()
        .then((module) => validateLoadedStory(route, module))
        .catch((error) => {
          loaded.delete(route)
          throw error
        })
      loaded.set(route, pending)
      return pending
    },
  })
}

/**
Builds the exact leaf id used by the pathname route tree.

@throws If any segment is not lowercase kebab-case.
*/
export function storyRoute(path: StorybookStoryPath): string {
  validateId("component", path.component)
  validateId("section", path.section)
  validateId("variant", path.variant)
  return `${path.component}/${path.section}/${path.variant}`
}

function normalizeControl(control: StorybookStoryControlInput): StorybookStoryControl {
  validateId("control", control.key)
  validateLabel("control", control.label)
  validateLabel("control group", control.group)
  const interactive = (control as Readonly<{interactive?: boolean}>).interactive
  const common = {
    key: control.key,
    label: control.label,
    group: control.group,
    ...(control.description === undefined ? {} : {description: control.description}),
  }

  if (control.kind === "select") {
    if (interactive === false) {
      throw new Error(`Storybook select control must be interactive: ${control.key}`)
    }
    if (control.options.length === 0) {
      throw new Error(`Storybook select control must contain options: ${control.key}`)
    }
    const optionValues = new Set<string>()
    const options = Object.freeze(control.options.map((option) => {
      validateLabel("control option", option.label)
      if (optionValues.has(option.value)) {
        throw new Error(`Duplicate Storybook control option: ${control.key}/${option.value}`)
      }
      optionValues.add(option.value)
      return Object.freeze({value: option.value, label: option.label})
    }))
    return Object.freeze({...common, kind: "select", interactive: true, options})
  }

  if (control.kind === "boolean") {
    if (interactive === false) {
      throw new Error(`Storybook boolean control must be interactive: ${control.key}`)
    }
    return Object.freeze({...common, kind: "boolean", interactive: true})
  }

  if (interactive !== false) {
    throw new Error(`Storybook ${control.kind} control must be explicitly noninteractive: ${control.key}`)
  }
  return Object.freeze({...common, kind: control.kind, interactive: false})
}

function validateLoadedStory(route: string, module: StorybookStoryModule): StorybookStoryModule {
  if (module === null || typeof module !== "object") throw new Error(`Storybook story did not load a module: ${route}`)
  if (module.defaultArgs === null || typeof module.defaultArgs !== "object" || Array.isArray(module.defaultArgs)) {
    throw new Error(`Storybook story defaultArgs must be an object: ${route}`)
  }
  if (!Array.isArray(module.controls)) throw new Error(`Storybook story controls must be an array: ${route}`)
  if (typeof module.render !== "function") throw new Error(`Storybook story render must be a function: ${route}`)
  if (typeof module.source !== "function") throw new Error(`Storybook story source must be a function: ${route}`)
  return module
}

function validateId(kind: string, value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Invalid storybook story ${kind} id: ${value}`)
  }
}

function validateLabel(kind: string, value: string): void {
  if (value.trim().length === 0) throw new Error(`Storybook story ${kind} label must not be empty`)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

function normalizeSearch(values: readonly string[]): string {
  return uniqueStrings(values).join(" ").toLocaleLowerCase("ru-RU")
}
