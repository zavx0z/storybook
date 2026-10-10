/**
Выводит каталог, вкладки и breadcrumb пути из подтверждённого физического графа.
Сохраняет положение пакета в общем каталоге при показе его применённой ревизии.
Переход к другому пакету передаёт владельцу страницы через предоставленный callback.

@packageDocumentation
*/
import ReadGraph from "@zavx0z/storybook-package-graph-read"
import type {StorybookAppWebPageNavigation} from "./contract"
import type {
  WorkbenchBreadcrumb,
  ExternalStorybookClientSnapshot,
  BrowserGraph,
  BrowserNode,
  ExternalStorybookBrowserNavigationItem,
  ExternalStorybookLandingModel,
  ExternalStorybookLandingSelection,
  ExternalStorybookPackageTabModel,
  StorybookBreadcrumbScope,
} from "./contract/types"
import {
  tab,
  viewUrlPath,
  navigationItem,
  packageDirectoryName,
  requiredRoute,
  browserNode,
  resolveBrowserRoute,
  landingBreadcrumbs,
  packageBreadcrumbs,
  graphPath,
} from "./src/implementation"
export type {StorybookAppWebPageNavigation} from "./contract"

const Owner: StorybookAppWebPageNavigation.Output = Object.freeze({
  /** Проецирует физических владельцев пакетов в дерево общего каталога. */
  deriveExternalStorybookLanding(graph: BrowserGraph): ExternalStorybookLandingModel {
    const items = graph.nodes
      .filter(node => node.kind === "package" || node.kind === "unavailable")
      .map(node => Object.freeze({
        ...navigationItem(graph, node, ReadGraph.browsePath(node)),
        ...(node.parentId === null ? {} : {parentId: node.parentId}),
      }))
    return Object.freeze({catalogItems: Object.freeze(items)})
  },

  /** Использует применённую ревизию для состава одного пакета и общий граф для его положения. */
  deriveExternalStorybookNavigationTree(
    graph: BrowserGraph,
    exactPackage?: Readonly<{packageId: string; graph: BrowserGraph}>,
  ): readonly ExternalStorybookBrowserNavigationItem[] {
    const graphIds = new Set(graph.nodes.map(node => node.id))
    const packageIds = exactPackage === undefined ? null : new Set(exactPackage.graph.nodes.map(node => node.id))
    const route = (node: BrowserNode): string => (node.kind === "directory" || node.kind === "entry") ? node.routePath ?? node.urlPath : ReadGraph.browsePath(node)
    const item = (source: BrowserGraph, node: BrowserNode, ids: ReadonlySet<string>): ExternalStorybookBrowserNavigationItem => Object.freeze({
      ...navigationItem(source, node, route(node)),
      expandable: node.childIds.some(id => ids.has(id)),
      ...(node.parentId === null ? {} : {parentId: node.parentId}),
    })
    const packageItems = exactPackage === undefined ? [] : exactPackage.graph.nodes
      .filter(node => node.packageId === exactPackage.packageId)
      .map(node => item(exactPackage.graph, node, packageIds!))
    const result: ExternalStorybookBrowserNavigationItem[] = []
    for (const node of graph.nodes) {
      if (exactPackage !== undefined && node.packageId === exactPackage.packageId) {
        if (node.kind === "package" && node.id === `package:${exactPackage.packageId}`) {
          result.push(...packageItems.map(packageItem => {
            if (packageItem.id !== node.id) return packageItem
            const {parentId: _isolatedParent, ...content} = packageItem
            const directoryName = packageDirectoryName(node) ?? node.label
            return Object.freeze({
              ...content,
              label: directoryName,
              searchText: `${directoryName} ${packageItem.title} ${packageItem.searchText}`,
              expandable: content.expandable || node.childIds.some(id => graphIds.has(id)),
              ...(node.parentId === null ? {} : {parentId: node.parentId}),
            })
          }))
        }
        continue
      }
      result.push(item(graph, node, graphIds))
    }
    return Object.freeze(result)
  },

  deriveExternalStorybookLandingSelection(graph: BrowserGraph, nodeId: string): ExternalStorybookLandingSelection {
    const selected = browserNode(graph, nodeId)
    if (selected.kind !== "package" && selected.kind !== "directory" && selected.kind !== "entry" && selected.kind !== "unavailable") {
      throw new Error(`External Storybook landing selection must be a physical node: ${nodeId}`)
    }
    return Object.freeze({overviewNode: selected})
  },

  /** Предоставляет один обзор владельца и только имеющиеся у него структурные вкладки. */
  deriveExternalStorybookPackageTab(
    graph: BrowserGraph,
    packageId: string,
    routePath: string,
  ): ExternalStorybookPackageTabModel {
    const packageNode = browserNode(graph, `package:${packageId}`)
    if (packageNode.kind !== "package" || packageNode.packageId !== packageId) {
      throw new Error(`External Storybook package tab identity is invalid: ${packageId}`)
    }
    const selectedNode = resolveBrowserRoute(graph, packageId, routePath)
    if (selectedNode.kind !== "package" && selectedNode.kind !== "directory" && selectedNode.kind !== "entry") {
      throw new Error(`External Storybook package route selected an invalid node: ${selectedNode.id}`)
    }
    const viewKind = selectedNode.scenariosRoutePath === routePath ? "scenarios"
      : selectedNode.contractRoutePath === routePath ? "contract"
        : selectedNode.dependencyRoutePath === routePath ? "dependencies" : "overview"
    const overview = tab(selectedNode, "overview", requiredRoute(selectedNode), selectedNode.urlPath, "Обзор")
    const tabs = Object.freeze([
      overview,
      ...(selectedNode.contractRoutePath === undefined ? [] : [tab(selectedNode, "contract", selectedNode.contractRoutePath, viewUrlPath(selectedNode.urlPath, "contract"), "Контракт")]),
      ...(selectedNode.dependencyRoutePath === undefined ? [] : [tab(selectedNode, "dependencies", selectedNode.dependencyRoutePath, viewUrlPath(selectedNode.urlPath, "dependencies"), "Зависимости")]),
      ...(selectedNode.scenariosRoutePath === undefined ? [] : [tab(selectedNode, "scenarios", selectedNode.scenariosRoutePath, viewUrlPath(selectedNode.urlPath, "scenarios"), "Сценарии")]),
    ])
    return Object.freeze({
      packageNode,
      selectedNode,
      viewKind,
      urlPath: viewKind === "overview" ? selectedNode.urlPath : viewUrlPath(selectedNode.urlPath, viewKind),
      tabs,
      tabActiveId: `${viewKind}:${selectedNode.id}`,
    })
  },

  /** Домашняя ссылка сохраняет общий адрес каталога и получает имя текущего Project. */
  storybookRootBreadcrumb(projectName: string): WorkbenchBreadcrumb {
    return Object.freeze({...Owner.STORYBOOK_ROOT_BREADCRUMB, label: projectName})
  },

  /** Выводит путь из точного графа браузера; имя Project принадлежит его корневой ссылке. */
  deriveStorybookBreadcrumbs(
    graph: ExternalStorybookClientSnapshot,
    selectedId: string,
    scope: StorybookBreadcrumbScope,
  ): readonly WorkbenchBreadcrumb[] {
    const path = graphPath(graph, selectedId)
    const breadcrumbs = scope.kind === "landing" ? landingBreadcrumbs(path) : packageBreadcrumbs(path, scope.ancestors)
    return Object.freeze([Owner.storybookRootBreadcrumb(graph.projectName), ...breadcrumbs])
  },

  /**
  Передаёт package intent единственному page owner без browser navigation fallback.

  @param input - Exact packageId и route, которые server resolver проверит перед mount.

  @param transition - Page-owned callback; direct scope не может менять `location` самостоятельно.

  @returns Завершение committed transition либо её rollback.

  @throws Если scope запущен без page controller или transition отклонена.

  @example
  ```ts
  await Owner.navigatePackage(
    {packageId: "@zavx0z/immersive/markdown", route: ""},
    page.navigatePackage,
  )
  ```
  */
  async navigatePackage(
    input: Readonly<{packageId: string; route: string}>,
    transition?: (input: Readonly<{packageId: string; route: string}>) => Promise<void>,
  ): Promise<void> {
    if (transition === undefined) {
      throw new Error("Storybook page controller is required for cross-package navigation")
    }
    await transition(input)
  },

  /** Общий каталог является корнем навигации, независимо от подключённых путей. */
  STORYBOOK_ROOT_BREADCRUMB: Object.freeze({
    id: "storybook:root",
    title: "Общий каталог Storybook",
    route: "",
    urlPath: "/",
})
})
export default Owner
