import type {StorybookPackageSession} from "@storybook-package/session"

/** Состояние исполнения, опубликованное владельцем StorybookPackageSession. */
export type PackageBuildState = ReturnType<StorybookPackageSession.Output["snapshot"]>["buildState"]
