/**
Route объединяет независимые возможности адресации и физического прохода
публичной структуры пакетов. Потребитель импортирует точного владельца.

@packageDocumentation
*/
export {default as formatRouteAddress} from "@route/address"
export type {RouteAddress} from "@route/address"
export {default as readRouteChildren} from "@route/children"
export type {RouteChildren} from "@route/children"
export {default as readRouteDirectories} from "@route/directories"
export type {RouteDirectories} from "@route/directories"
export {default as readRouteIgnored} from "@route/ignored"
export type {RouteIgnored} from "@route/ignored"
export {default as resolveRoute} from "@route/resolve"
export type {RouteResolve} from "@route/resolve"
export {default as readRouteStructure} from "@route/structure"
export type {RouteStructure} from "@route/structure"
export {default as readWorkspacePackages} from "@route/workspaces"
export type {RouteWorkspaces} from "@route/workspaces"
export {default as routeUrl} from "@route/url"
export type {RouteUrl} from "@route/url"
