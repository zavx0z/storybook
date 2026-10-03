import type {AppWebProtocol} from "@app-web/protocol"
import type {PackageGraphCreate} from "@package-graph/create"
import type {WebWorkbench} from "@web/workbench"
import type {PackageRevision} from "@package/revision"

export type WorkbenchBreadcrumb = NonNullable<ReturnType<WebWorkbench.Output["getSnapshot"]>["state"]["status"]["breadcrumbs"]>[number]

export type ExternalStorybookClientSnapshot = ReturnType<AppWebProtocol.Output["clientSnapshot"]>

export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]

export type ExternalStorybookGraph = PackageGraphCreate.Output

export type ExternalStorybookGraphNode = ExternalStorybookGraph["nodes"][number]

export type BrowserGraph = ExternalStorybookGraph | ExternalStorybookClientSnapshot

export type BrowserNode = ExternalStorybookGraphNode | ExternalStorybookClientNode

export type ExternalStorybookBrowserNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
  expandable?: boolean
  parentId?: string
}>

export type ExternalStorybookBrowserTabItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
}>

export type ExternalStorybookLandingModel = Readonly<{
  catalogItems: readonly ExternalStorybookBrowserNavigationItem[]
}>

export type ExternalStorybookLandingSelection = Readonly<{
  overviewNode: BrowserNode
}>

export type ExternalStorybookPackageTabModel = Readonly<{
  packageNode: BrowserNode
  selectedNode: BrowserNode
  viewKind: "overview" | "dependencies" | "contract" | "scenarios"
  urlPath: string
  tabs: readonly ExternalStorybookBrowserTabItem[]
  tabActiveId: string
}>

export type StorybookPackageRevisionAncestor = ReturnType<PackageRevision.Output["create"]>["ancestors"][number]

export type StorybookBreadcrumbScope =
  | Readonly<{kind: "landing"}>
  | Readonly<{
    kind: "package"
    ancestors: readonly StorybookPackageRevisionAncestor[]
  }>
