import {
  defineStorybookDomCatalog,
  type StorybookDomCatalogIndexItem,
} from "@zavx0z/storybook/catalog"
import type {StorybookDomStoryModule} from "@zavx0z/storybook/stories"
import {
  STORYBOOK_DOCUMENTATION_MODULES,
  type StorybookDocumentationModuleId,
} from "../contracts/examples.ts"

export type StorybookDocumentationStory = StorybookDomStoryModule<Record<string, unknown>>

const loadContract = (
  id: StorybookDocumentationModuleId,
) => async (): Promise<StorybookDocumentationStory> => {
  const {createStorybookContractStory} = await import("./stories/contract.ts")
  return createStorybookContractStory(id)
}

const loadButton = (
  variant: "contained" | "outlined" | "glass",
  disabled: boolean,
) => async (): Promise<StorybookDocumentationStory> => {
  const {createStorybookWorkbenchButtonStory} = await import("./stories/button.ts")
  return createStorybookWorkbenchButtonStory({variant, disabled})
}

export const STORYBOOK_DOCUMENTATION_CATALOG = defineStorybookDomCatalog<
  StorybookDocumentationStory,
  StorybookDocumentationStory
>({
  groups: [{
    id: "public-contracts",
    label: "Публичные модули",
    components: STORYBOOK_DOCUMENTATION_MODULES.map((module) => ({
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
            load: loadContract(module.id),
          }],
        },
        ...(module.id === "workbench" ? [{
          id: "live",
          label: "Живой DOM",
          variants: [
            {
              id: "primary",
              label: "Основная",
              title: "DOM Workbench · Основная кнопка",
              load: loadButton("contained", false),
            },
            {
              id: "outlined",
              label: "Контурная",
              title: "DOM Workbench · Контурная кнопка",
              load: loadButton("outlined", false),
            },
            {
              id: "disabled",
              label: "Недоступная",
              title: "DOM Workbench · Недоступная кнопка",
              load: loadButton("contained", true),
            },
          ],
        }] : []),
      ],
    })),
  }],
  representative: {component: "route-tree", section: "contract", variant: "overview"},
  normalizeModule(route, loaded) {
    if (
      typeof loaded !== "object" ||
      loaded === null ||
      typeof loaded.render !== "function" ||
      typeof loaded.source !== "function"
    ) throw new Error(`Invalid Storybook documentation DOM story: ${route}`)
    return loaded
  },
})

export function storybookDocumentationIndex(route: string): StorybookDomCatalogIndexItem {
  const index = STORYBOOK_DOCUMENTATION_CATALOG.find(route)
  if (index === undefined) throw new Error(`Unknown Storybook documentation story: ${route}`)
  return index
}

export function storybookDocumentationContext(
  route: string,
): StorybookDomCatalogIndexItem | null {
  const exact = STORYBOOK_DOCUMENTATION_CATALOG.find(route)
  if (exact !== undefined) return exact
  const prefix = route.length === 0 ? "" : `${route}/`
  return STORYBOOK_DOCUMENTATION_CATALOG.index.find(({route: leaf}) => (
    prefix.length === 0 || leaf.startsWith(prefix)
  )) ?? null
}
