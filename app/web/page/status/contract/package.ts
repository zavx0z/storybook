import type {PackageSession} from "@package/session"

/** Состояние исполнения, опубликованное владельцем PackageSession. */
export type PackageBuildState = ReturnType<PackageSession.Output["snapshot"]>["buildState"]
