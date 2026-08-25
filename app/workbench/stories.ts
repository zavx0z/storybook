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

/**
Selects the leaf rendered inside an overview without changing its URL.

The root uses the declared representative. A component or section overview
uses its first owned descendant. Unknown paths still fail closed.

@throws If `path` is not a registered overview or leaf.
*/
export function storybookWorkbenchPresentationRoute(path: string): string {
  const node = STORYBOOK_WORKBENCH_STORIES.routeTree.find(path)
  if (node === undefined) throw new Error(`Unknown Storybook Workbench route: ${path}`)
  if (node.kind === "leaf") return node.path
  if (node.path.length === 0) return STORYBOOK_WORKBENCH_STORIES.representative
  const prefix = `${node.path}/`
  const descendant = STORYBOOK_WORKBENCH_STORIES.index.find(({route}) => route.startsWith(prefix))
  if (descendant === undefined) throw new Error(`Storybook Workbench overview has no story: ${path}`)
  return descendant.route
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
