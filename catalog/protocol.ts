/** Версии существующего каталога и браузерного представления. */

export const EXTERNAL_STORYBOOK_SCHEMA_VERSION = 1 as const
export const STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL = "widget-contribution/1" as const
export const STORYBOOK_STORY_PRESENTATION_PROTOCOL = "story-presentation/1" as const
export const STORYBOOK_STANDARD_WIDGET_IDS = Object.freeze([
  "props",
  "source",
  "events",
  "diagnostics",
  "dom",
  "layout",
  "display",
  "reference",
] as const)
