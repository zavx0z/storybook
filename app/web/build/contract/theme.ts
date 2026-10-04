import type {StorybookPackageRevision} from "@zavx0z/storybook-package-revision"

/** Источник темы Web имеет форму источника CSS, принадлежащую StorybookPackageRevision. */
export type WebAuthorStyleSheet = NonNullable<Parameters<StorybookPackageRevision.Output["create"]>[3]>[number]
