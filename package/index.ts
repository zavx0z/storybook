/**
Собирает публичные возможности работы с пакетом и его собственными ревизиями.
Каждый читатель и исполнитель сохраняет реализацию у своего владельца.

@packageDocumentation
*/
export {default as readPackage} from "@archetypes/package"
export {default as readPackageJson} from "@archetypes/package-json"
export {default as readPackageIndex} from "@archetypes/package-index"
export {default as readModuleDocumentation} from "@archetypes/package-documentation"
export {default as PackageSession} from "@package/session"
export {default as Revision} from "@package/revision"
export {default as Standard} from "@package/standard"
export {default as collectUnpublishedArtifacts} from "@package/artifacts"
export {default as activateRevision} from "@hmr/activation"

export type {ArchetypesPackage} from "@archetypes/package"
export type {ArchetypesPackageJson} from "@archetypes/package-json"
export type {ArchetypesPackageIndex} from "@archetypes/package-index"
export type {ArchetypesPackageDocumentation} from "@archetypes/package-documentation"
export type {PackageRevision} from "@package/revision"
export type {PackageStandard} from "@package/standard"
export type {PackageArtifacts} from "@package/artifacts"
export type {HmrActivation} from "@hmr/activation"
export {default as createRevisionBuilder} from "@package-build/prepare"
export type {PackageBuildPrepare} from "@package-build/prepare"
export {createExternalStorybookGraph, readExternalStorybookGraph} from "@package/graph"
export type {PackageGraphCreate, PackageGraphRead} from "@package/graph"
export {resolveRoute, formatRouteAddress, readRouteChildren, readRouteDirectories, readRouteIgnored, readWorkspacePackages} from "@storybook/route"
export {default as Identity} from "@package/identity"
export type {PackageIdentity} from "@package/identity"
export {default as createResourceAllowList} from "@package/resources"
export type {PackageResources} from "@package/resources"
