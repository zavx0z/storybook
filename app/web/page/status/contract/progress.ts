import type {StorybookPackageBuildScheduler} from "@zavx0z/storybook-package-build-scheduler"

export type BuildTransition = Parameters<Parameters<StorybookPackageBuildScheduler.Output["subscribe"]>[0]>[0]
export type BuildReason = NonNullable<BuildTransition["reason"]>
export type BuildCacheStatus = NonNullable<BuildTransition["cache"]>["status"]
export type BuildCacheLayer = NonNullable<BuildTransition["cache"]>["layer"]

export type BuildProgress = BuildTransition & Readonly<{
  reason?: BuildReason
  cache?: Readonly<{status: BuildCacheStatus, layer: BuildCacheLayer}>
}>

/** Переход catalog refresh, публикуемый только вокруг фактического resolver pass. */
export type CatalogProgress = Readonly<{
  type: "catalog.progress"
  state: "running" | "completed" | "failed"
}>
