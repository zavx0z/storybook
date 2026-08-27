import {
  defineStorybookRouteTree,
  type StorybookRouteTree,
} from "../route-tree.ts"

export type StorybookDomCatalogLoader<LoadedModule> = () => Promise<LoadedModule>

export type StorybookDomCatalogVariant<LoadedModule> = Readonly<{
  id: string
  label: string
  title: string
  tags?: readonly string[]
  load: StorybookDomCatalogLoader<LoadedModule>
}>

export type StorybookDomCatalogSection<LoadedModule> = Readonly<{
  id: string
  label: string
  variants: readonly StorybookDomCatalogVariant<LoadedModule>[]
}>

export type StorybookDomCatalogComponent<LoadedModule> = Readonly<{
  id: string
  label: string
  apiName: string
  tags?: readonly string[]
  sections: readonly StorybookDomCatalogSection<LoadedModule>[]
}>

export type StorybookDomCatalogGroup<LoadedModule> = Readonly<{
  id: string
  label: string
  components: readonly StorybookDomCatalogComponent<LoadedModule>[]
}>

export type StorybookDomCatalogPath = Readonly<{
  component: string
  section: string
  variant: string
}>

export type StorybookDomCatalogIndexItem = Readonly<{
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

export type StorybookDomCatalog<Module> = Readonly<{
  routeTree: StorybookRouteTree<string>
  index: readonly StorybookDomCatalogIndexItem[]
  representative: string
  find(route: string): StorybookDomCatalogIndexItem | undefined
  variants(route: string): readonly StorybookDomCatalogIndexItem[]
  load(route: string): Promise<Module>
}>

export type StorybookDomCatalogDefinition<LoadedModule, Module> = Readonly<{
  groups: readonly StorybookDomCatalogGroup<LoadedModule>[]
  representative: StorybookDomCatalogPath
  normalizeModule(route: string, loaded: LoadedModule): Module
}>

type InternalStory<LoadedModule> = Readonly<{
  index: StorybookDomCatalogIndexItem
  load: StorybookDomCatalogLoader<LoadedModule>
}>

/** Target-neutral hierarchy and exact lazy loader for DOM Workbench consumers. */
export function defineStorybookDomCatalog<const LoadedModule, Module = LoadedModule>(
  input: StorybookDomCatalogDefinition<LoadedModule, Module>,
): StorybookDomCatalog<Module> {
  if (typeof input.normalizeModule !== "function") {
    throw new Error("Storybook DOM catalog normalizeModule must be a function")
  }
  if (input.groups.length === 0) throw new Error("Storybook DOM catalog must contain at least one group")
  const stories: InternalStory<LoadedModule>[] = []
  const groupIds = new Set<string>()
  const componentIds = new Set<string>()

  for (const group of input.groups) {
    validateId("group", group.id)
    validateLabel("group", group.label)
    if (groupIds.has(group.id)) throw new Error(`Duplicate Storybook DOM group: ${group.id}`)
    groupIds.add(group.id)
    if (group.components.length === 0) throw new Error(`Storybook DOM group has no components: ${group.id}`)

    for (const component of group.components) {
      validateId("component", component.id)
      validateLabel("component", component.label)
      validateLabel("component apiName", component.apiName)
      if (componentIds.has(component.id)) throw new Error(`Duplicate Storybook DOM component: ${component.id}`)
      componentIds.add(component.id)
      if (component.sections.length === 0) {
        throw new Error(`Storybook DOM component has no sections: ${component.id}`)
      }
      const sectionIds = new Set<string>()

      for (const section of component.sections) {
        validateId("section", section.id)
        validateLabel("section", section.label)
        if (sectionIds.has(section.id)) {
          throw new Error(`Duplicate Storybook DOM section: ${component.id}/${section.id}`)
        }
        sectionIds.add(section.id)
        if (section.variants.length === 0) {
          throw new Error(`Storybook DOM section has no variants: ${component.id}/${section.id}`)
        }
        const variantIds = new Set<string>()

        for (const variant of section.variants) {
          validateId("variant", variant.id)
          validateLabel("variant", variant.label)
          validateLabel("story title", variant.title)
          if (variantIds.has(variant.id)) {
            throw new Error(`Duplicate Storybook DOM variant: ${component.id}/${section.id}/${variant.id}`)
          }
          variantIds.add(variant.id)
          if (typeof variant.load !== "function") throw new Error("Storybook DOM loader must be a function")
          const route = storybookDomCatalogRoute({
            component: component.id,
            section: section.id,
            variant: variant.id,
          })
          const tags = Object.freeze(uniqueStrings([...(component.tags ?? []), ...(variant.tags ?? [])]))
          const index: StorybookDomCatalogIndexItem = Object.freeze({
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
  const representative = storybookDomCatalogRoute(input.representative)
  if (!byRoute.has(representative)) {
    throw new Error(`Storybook DOM representative route is not registered: ${representative}`)
  }
  const loaded = new Map<string, Promise<Module>>()
  const index = Object.freeze(stories.map((story) => story.index))
  const noVariants = Object.freeze([]) as readonly StorybookDomCatalogIndexItem[]

  return Object.freeze({
    routeTree,
    index,
    representative,
    find(route) {
      return byRoute.get(route)?.index
    },
    variants(route) {
      const selected = byRoute.get(route)?.index
      if (selected === undefined) return noVariants
      return Object.freeze(index.filter((item) =>
        item.componentId === selected.componentId && item.sectionId === selected.sectionId))
    },
    load(route) {
      const story = byRoute.get(route)
      if (story === undefined) return Promise.reject(new Error(`Unknown Storybook DOM route: ${route}`))
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

export function storybookDomCatalogRoute(path: StorybookDomCatalogPath): string {
  validateId("component", path.component)
  validateId("section", path.section)
  validateId("variant", path.variant)
  return `${path.component}/${path.section}/${path.variant}`
}

const validateId = (kind: string, value: string): void => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error(`Invalid Storybook DOM ${kind} id: ${value}`)
  }
}

const validateLabel = (kind: string, value: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Storybook DOM ${kind} label must not be empty`)
  }
}

const uniqueStrings = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]

const normalizeSearch = (values: readonly string[]): string =>
  uniqueStrings(values).join(" ").toLocaleLowerCase("ru-RU")
