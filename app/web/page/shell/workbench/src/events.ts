/**
Имена семантических событий, передаваемых из рабочей области принимающей стороне.
*/
export const WORKBENCH_EVENTS = Object.freeze({
  navigate: "storybooknavigate",
  search: "storybooksearch",
  tab: "storybooktab",
  inspector: "storybookinspector",
  groupToggle: "storybookgrouptoggle",
  catalogAction: "storybookcatalogaction",
} as const)

/**
Маркер версии контракта раскладки рабочей области Storybook.
*/
export const WORKBENCH_LAYOUT_PROTOCOL = "workbench-layout/3" as const

/**
Именованные области раскладки: каталог, вкладки, просмотр, инспектор и строка состояния.
*/
export const WORKBENCH_REGIONS = Object.freeze([
  "tabs",
  "preview",
  "inspector",
  "catalog",
  "status",
] as const)
