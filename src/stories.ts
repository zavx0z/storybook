/**
Eager Storybook catalog metadata and lazy repository-owned story modules.

The target-agnostic catalog knows only hierarchy, routes and an owner-supplied
module normalizer. It never assumes a render target. The UI-specific helpers
layer `UiSurface` args, controls, rendering and source generation on that same
catalog without changing its loading laws.

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

/** Loads one owner implementation without importing it into the eager catalog graph. */
export type StorybookStoryLoader<LoadedModule = StorybookStoryModule> = () => Promise<LoadedModule>

export type StorybookStoryVariantInput<LoadedModule = StorybookStoryModule> = Readonly<{
  id: string
  label: string
  title: string
  tags?: readonly string[]
  load: StorybookStoryLoader<LoadedModule>
}>

export type StorybookStorySectionInput<LoadedModule = StorybookStoryModule> = Readonly<{
  id: string
  label: string
  variants: readonly StorybookStoryVariantInput<LoadedModule>[]
}>

export type StorybookStoryComponentInput<LoadedModule = StorybookStoryModule> = Readonly<{
  id: string
  label: string
  apiName: string
  tags?: readonly string[]
  sections: readonly StorybookStorySectionInput<LoadedModule>[]
}>

export type StorybookStoryGroupInput<LoadedModule = StorybookStoryModule> = Readonly<{
  id: string
  label: string
  components: readonly StorybookStoryComponentInput<LoadedModule>[]
}>

export type StorybookStoryPath = Readonly<{
  component: string
  section: string
  variant: string
}>

export type StorybookStoryCatalogInput<LoadedModule = StorybookStoryModule> = Readonly<{
  groups: readonly StorybookStoryGroupInput<LoadedModule>[]
  /** Detail shown by an overview before the owner makes a more local choice. */
  representative: StorybookStoryPath
}>

/**
Target-specific validation and normalization for one lazily loaded value.

The generic catalog deliberately cannot inspect an Engine, DOM, SVG or UI
module. Its owner receives the exact registered route and must throw for an
invalid value; a successful return becomes the cached public module.
*/
export type StorybookStoryModuleNormalizer<LoadedModule, Module = LoadedModule> = (
  route: string,
  loaded: LoadedModule,
) => Module

/**
Owner hierarchy plus the only target-specific step in the generic catalog.

`normalizeModule` is required even when `LoadedModule` and `Module` are equal:
the explicit callback prevents an unvalidated dynamic import from becoming a
shared Storybook contract accidentally.
*/
export type StorybookStoryCatalogDefinition<LoadedModule, Module = LoadedModule> = Readonly<
  StorybookStoryCatalogInput<LoadedModule> & {
    normalizeModule: StorybookStoryModuleNormalizer<LoadedModule, Module>
  }
>

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
export type StorybookStoryCatalog<Module> = Readonly<{
  routeTree: StorybookRouteTree<string>
  index: readonly StorybookStoryIndexItem[]
  representative: string
  find(route: string): StorybookStoryIndexItem | undefined
  variants(route: string): readonly StorybookStoryIndexItem[]
  load(route: string): Promise<Module>
}>

/** UI-specific catalog preserved for existing Workbench consumers. */
export type StorybookStoryRegistry = StorybookStoryCatalog<StorybookStoryModule>

type InternalStory<LoadedModule> = Readonly<{
  index: StorybookStoryIndexItem
  load: StorybookStoryLoader<LoadedModule>
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
Flattens target-agnostic owner descriptors into an eager index and lazy cache.

Only eager metadata is read while the catalog is defined. A loader runs after
an exact `load(route)` call, and concurrent calls receive the same promise.
`normalizeModule` validates the result before it enters the cache. A loader or
normalizer failure removes that promise so a later owner-controlled call can
retry.

`representative` must name a real leaf, but it is not consulted by `find()` or
`load()`. Unknown routes therefore reject instead of selecting a fallback.

@param input - Owner hierarchy, representative leaf and target-specific module
normalizer. The normalizer must throw when a loaded value violates the owner's
module contract.

@returns An immutable eager index and exact-route lazy loader.

@throws If `normalizeModule` is not a function, hierarchy metadata is malformed,
duplicated or empty, or the representative leaf is not registered. Loader and
normalizer failures reject `load()` and remain retryable.

@example
```ts
type OwnerStory = Readonly<{present(): void}>

const stories = defineStorybookStoryCatalog<unknown, OwnerStory>({
  groups: [{
    id: "examples",
    label: "Примеры",
    components: [{
      id: "scene",
      label: "Сцена",
      apiName: "SceneExample",
      sections: [{
        id: "basic",
        label: "Основное",
        variants: [{
          id: "default",
          label: "Обычная",
          title: "Обычная сцена",
          load: async () => import("./scene.story.ts"),
        }],
      }],
    }],
  }],
  representative: {component: "scene", section: "basic", variant: "default"},
  normalizeModule(route, loaded): OwnerStory {
    if (loaded === null || typeof loaded !== "object" || !("present" in loaded)) {
      throw new Error(`Invalid owner story: ${route}`)
    }
    return loaded as OwnerStory
  },
})
```
*/
export function defineStorybookStoryCatalog<const LoadedModule, Module = LoadedModule>(
  input: StorybookStoryCatalogDefinition<LoadedModule, Module>,
): StorybookStoryCatalog<Module> {
  if (typeof input.normalizeModule !== "function") {
    throw new Error("Storybook story catalog normalizeModule must be a function")
  }
  if (input.groups.length === 0) throw new Error("Storybook story catalog must contain at least one group")
  const stories: InternalStory<LoadedModule>[] = []
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
  const loaded = new Map<string, Promise<Module>>()
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
      const pending = Promise.resolve()
        .then(() => story.load())
        .then((module) => input.normalizeModule(route, module))
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
Defines the retained UI Workbench story protocol on the generic lazy catalog.

This UI convenience API keeps the original `StorybookStoryModule` shape and
performs its structural validation through the generic `normalizeModule` hook.
Use {@link defineStorybookStoryCatalog} when the owner renders to another
target and must not provide `UiSurface` behavior.

@throws If hierarchy or a loaded UI story module violates the existing
Storybook contract.
*/
export function defineStorybookStories(input: StorybookStoryCatalogInput): StorybookStoryRegistry {
  return defineStorybookStoryCatalog({
    ...input,
    normalizeModule: validateLoadedStory,
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
