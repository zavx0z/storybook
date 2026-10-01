export type Kind =
  | "storybook-package"
  | "storybook-dependency"
  | "storybook-import"
  | "storybook-wrapper"
  | "storybook-lifecycle"
  | "production-story-export"

export type Violation = Readonly<{
  root: string
  path: string
  kind: Kind
  detail: string
}>
