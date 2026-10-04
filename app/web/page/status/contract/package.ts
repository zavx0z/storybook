import type {Zavx0zStorybookPackageSession} from "@zavx0z/storybook-package-session"

/** Состояние исполнения, опубликованное владельцем Zavx0zStorybookPackageSession. */
export type PackageBuildState = ReturnType<Zavx0zStorybookPackageSession.Output["snapshot"]>["buildState"]
