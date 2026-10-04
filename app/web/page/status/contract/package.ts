import type {StorybookPackageSession} from "@zavx0z/storybook-package-session"

/** Состояние исполнения, опубликованное владельцем StorybookPackageSession. */
export type PackageBuildState = ReturnType<StorybookPackageSession.Output["snapshot"]>["buildState"]
