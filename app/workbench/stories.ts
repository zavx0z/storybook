/**
Package-owned examples for the `@zavx0z/storybook` Workbench documentation.

Only eager labels and routes live in this module. The real UI implementation
stays behind a dynamic import so the documentation demonstrates the same lazy
boundary required from repository consumers.

@packageDocumentation
*/

import {
  defineStorybookStories,
  type StorybookStoryComponentInput,
  type StorybookStoryIndexItem,
  type StorybookStoryModule,
} from "@zavx0z/storybook/stories"
import {
  STORYBOOK_DOCUMENTATION_MODULES,
  type StorybookDocumentationModuleId,
} from "../contracts/examples.ts"

export type StorybookWorkbenchButtonPreset = Readonly<{
  variant: "contained" | "outlined" | "glass"
  disabled: boolean
}>

let buttonClickHandler = (): void => {}

const loadButtonStory = (
  preset: StorybookWorkbenchButtonPreset,
) => async (): Promise<StorybookStoryModule> => {
  const {createStorybookWorkbenchButtonStory} = await import("./stories/button.ts")
  return createStorybookWorkbenchButtonStory(preset, () => buttonClickHandler())
}

const loadContractStory = (
  id: StorybookDocumentationModuleId,
) => async (): Promise<StorybookStoryModule> => {
  const {createStorybookContractStory} = await import("./stories/contract.ts")
  return createStorybookContractStory(id)
}

const documentationComponents = STORYBOOK_DOCUMENTATION_MODULES.map((module): StorybookStoryComponentInput => ({
  id: module.id,
  label: module.title,
  apiName: module.importPath,
  tags: ["документация", "public-api"],
  sections: [
    {
      id: "contract",
      label: "Контракт",
      variants: [{
        id: "overview",
        label: "Обзор",
        title: `${module.title} · Контракт`,
        load: loadContractStory(module.id),
      }],
    },
    ...(module.id === "workbench" ? [{
      id: "live",
      label: "Живой пример",
      variants: [
        {
          id: "primary",
          label: "Основная",
          title: "Workbench · Основная кнопка",
          load: loadButtonStory({variant: "contained", disabled: false}),
        },
        {
          id: "outlined",
          label: "Контурная",
          title: "Workbench · Контурная кнопка",
          load: loadButtonStory({variant: "outlined", disabled: false}),
        },
        {
          id: "disabled",
          label: "Недоступная",
          title: "Workbench · Недоступная кнопка",
          load: loadButtonStory({variant: "contained", disabled: true}),
        },
      ],
    }] : []),
  ],
}))

/**
The documentation application's own lazy story registry.

The root app manifest reads `routeTree` from this value, while the browser page
uses the same object for presentation. This keeps server routes and browser
navigation on one exact source of truth.
*/
export const STORYBOOK_WORKBENCH_STORIES = defineStorybookStories({
  groups: [{
    id: "public-contracts",
    label: "Публичные модули",
    components: documentationComponents,
  }],
  representative: {component: "route-tree", section: "contract", variant: "overview"},
})

/** Resolves one exact overview or leaf presentation without a descendant fallback. */
export function storybookWorkbenchPresentationRoute(path: string): string {
  const node = STORYBOOK_WORKBENCH_STORIES.routeTree.find(path)
  if (node === undefined) throw new Error(`Unknown Storybook Workbench route: ${path}`)
  return node.path
}

export function storybookWorkbenchPresentationIndex(route: string): StorybookStoryIndexItem {
  const detail = STORYBOOK_WORKBENCH_STORIES.find(route)
  if (detail !== undefined) return detail
  const node = STORYBOOK_WORKBENCH_STORIES.routeTree.find(route)
  if (node?.kind !== "overview") throw new Error(`Unknown Storybook Workbench presentation: ${route}`)
  const representative = STORYBOOK_WORKBENCH_STORIES.index.find(({route: leaf}) => (
    node.path.length === 0 || leaf.startsWith(`${node.path}/`)
  ))
  if (representative === undefined) throw new Error(`Storybook Workbench overview has no story: ${route}`)
  const segments = node.path.length === 0 ? [] : node.path.split("/")
  return Object.freeze({
    ...representative,
    route: node.path,
    componentId: segments[0] ?? "",
    componentLabel: segments.length === 0 ? "Документация Storybook" : representative.componentLabel,
    sectionId: segments[1] ?? "",
    sectionLabel: segments.length < 2 ? "Обзор" : representative.sectionLabel,
    variantId: "overview",
    variantLabel: "Обзор",
    title: segments.length === 0
      ? "Документация Storybook · Обзор"
      : `${segments.length === 1 ? representative.componentLabel : representative.sectionLabel} · Обзор`,
  })
}

export async function loadStorybookWorkbenchPresentation(route: string): Promise<StorybookStoryModule> {
  const detail = STORYBOOK_WORKBENCH_STORIES.find(route)
  if (detail !== undefined) return STORYBOOK_WORKBENCH_STORIES.load(detail.route)
  const index = storybookWorkbenchPresentationIndex(route)
  const {createStorybookOverviewStory} = await import("./stories/overview.ts")
  return createStorybookOverviewStory({
    title: index.title,
    items: storybookWorkbenchOverviewItems(route),
  })
}

function storybookWorkbenchOverviewItems(route: string): readonly Readonly<{label: string; route: string}>[] {
  const segments = route.length === 0 ? [] : route.split("/")
  if (segments.length === 0) {
    const seen = new Set<string>()
    return STORYBOOK_WORKBENCH_STORIES.index.flatMap((item) => {
      if (seen.has(item.componentId)) return []
      seen.add(item.componentId)
      return [{label: item.componentLabel, route: item.componentId}]
    })
  }
  const selected = storybookWorkbenchPresentationIndex(route)
  if (segments.length === 1) {
    const seen = new Set<string>()
    return STORYBOOK_WORKBENCH_STORIES.index.flatMap((item) => {
      if (item.componentId !== selected.componentId || seen.has(item.sectionId)) return []
      seen.add(item.sectionId)
      return [{label: item.sectionLabel, route: `${item.componentId}/${item.sectionId}`}]
    })
  }
  return STORYBOOK_WORKBENCH_STORIES.index
    .filter((item) => item.componentId === selected.componentId && item.sectionId === selected.sectionId)
    .map((item) => ({label: item.variantLabel, route: item.route}))
}

/**
Connects the rendered Button to the page-owned event journal.

The lazy story captures a stable bridge rather than page state. Replacing the
handler therefore updates already-loaded story modules without rebuilding the
registry or its cache.

@returns A release function that clears only this exact handler.
*/
export function observeStorybookWorkbenchButtonClicks(handler: () => void): () => void {
  buttonClickHandler = handler
  return () => {
    if (buttonClickHandler === handler) buttonClickHandler = () => {}
  }
}
