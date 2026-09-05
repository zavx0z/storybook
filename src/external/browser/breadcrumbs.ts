import type {WorkbenchBreadcrumb} from "../../workbench/contract.ts"
import {homeIcon} from "@zavx0z/ui/themes/icons"
import type {StorybookPackageRevisionAncestor} from "../package-revision.ts"
import type {
  ExternalStorybookClientNode,
  ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"

export type StorybookBreadcrumbScope =
  | Readonly<{kind: "landing"}>
  | Readonly<{
    kind: "package"
    ancestors: readonly StorybookPackageRevisionAncestor[]
  }>

/** Общий каталог является корнем навигации, независимо от корней declaration-графа. */
export const STORYBOOK_ROOT_BREADCRUMB: WorkbenchBreadcrumb = Object.freeze({
  id: "storybook:root",
  label: "Главная",
  title: "Общий каталог Storybook",
  iconSrc: homeIcon,
  route: "",
  urlPath: "/",
})

/** Derives one ordered breadcrumb path from the exact browser graph projection. */
export function deriveStorybookBreadcrumbs(
  graph: ExternalStorybookClientSnapshot,
  selectedId: string,
  scope: StorybookBreadcrumbScope,
): readonly WorkbenchBreadcrumb[] {
  const path = graphPath(graph, selectedId)
  const breadcrumbs = scope.kind === "landing" ? landingBreadcrumbs(path) : packageBreadcrumbs(path, scope.ancestors)
  return Object.freeze([STORYBOOK_ROOT_BREADCRUMB, ...breadcrumbs])
}

function landingBreadcrumbs(
  path: readonly ExternalStorybookClientNode[],
): readonly WorkbenchBreadcrumb[] {
  if (path.length === 0 || path.some(node =>
    node.kind !== "workspace" && node.kind !== "project" && node.kind !== "package")) {
    throw new Error("Storybook landing breadcrumb path must contain only declaration nodes")
  }
  return Object.freeze(path.map(node => Object.freeze({
    id: node.id,
    label: node.label,
    route: "",
    title: node.id,
  })))
}

function packageBreadcrumbs(
  path: readonly ExternalStorybookClientNode[],
  revisionAncestors: readonly StorybookPackageRevisionAncestor[],
): readonly WorkbenchBreadcrumb[] {
  const packageIndex = path.findIndex(node => node.kind === "package")
  if (packageIndex < 0) {
    throw new Error(`Storybook breadcrumb path has no package root: ${path.at(-1)?.id ?? "unknown"}`)
  }
  const graphAncestors = path.slice(0, packageIndex)
  if (graphAncestors.some(node => node.kind !== "workspace" && node.kind !== "project")) {
    throw new Error("Storybook package breadcrumb ancestors must be workspace or project nodes")
  }
  if (revisionAncestors.length > 0 && graphAncestors.length > 0 &&
    JSON.stringify(revisionAncestors.map(({id}) => id)) !== JSON.stringify(graphAncestors.map(({id}) => id))) {
    throw new Error("Storybook package breadcrumb ancestors differ from the browser graph")
  }
  const ancestors = revisionAncestors.length > 0
    ? revisionAncestors
    : graphAncestors.map(node => Object.freeze({
      id: node.id,
      kind: node.kind as "workspace" | "project",
      label: node.label,
      urlPath: node.urlPath,
    }))
  const packagePath = path.slice(packageIndex)
  if (packagePath[0]?.kind !== "package" || packagePath.some(node =>
    node.kind !== "package" && node.kind !== "category" && node.kind !== "subject" && node.kind !== "variant")) {
    throw new Error(`Storybook package breadcrumb path is invalid: ${path.at(-1)?.id ?? "unknown"}`)
  }
  return Object.freeze([
    ...ancestors.map(ancestor => Object.freeze({
      id: ancestor.id,
      label: ancestor.label,
      route: "",
      urlPath: ancestor.urlPath,
      title: ancestor.id,
    })),
    ...packagePath.map(node => {
      if (node.routePath === null) {
        throw new Error(`Storybook package breadcrumb has no route: ${node.id}`)
      }
      return Object.freeze({
        id: node.id,
        label: node.label,
        route: node.routePath,
        title: node.id,
      })
    }),
  ])
}

function graphPath(
  graph: ExternalStorybookClientSnapshot,
  selectedId: string,
): readonly ExternalStorybookClientNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node] as const))
  const selected = byId.get(selectedId)
  if (selected === undefined) throw new Error(`Unknown Storybook breadcrumb node: ${selectedId}`)
  const reverse: ExternalStorybookClientNode[] = []
  const visited = new Set<string>()
  let current: ExternalStorybookClientNode | undefined = selected
  while (current !== undefined) {
    if (visited.has(current.id)) throw new Error(`Cyclic Storybook breadcrumb path: ${current.id}`)
    visited.add(current.id)
    reverse.push(current)
    if (current.parentId === null) break
    const parent = byId.get(current.parentId)
    if (parent === undefined || !parent.childIds.includes(current.id)) {
      throw new Error(`Broken Storybook breadcrumb parent: ${current.id}`)
    }
    current = parent
  }
  return Object.freeze(reverse.reverse())
}
