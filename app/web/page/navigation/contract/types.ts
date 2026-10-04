import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {Zavx0zStorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {Zavx0zStorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import type {Zavx0zStorybookPackageRevision} from "@zavx0z/storybook-package-revision"

export type WorkbenchBreadcrumb = NonNullable<ReturnType<Zavx0zStorybookAppWebPageShellWorkbench.Output["getSnapshot"]>["state"]["status"]["breadcrumbs"]>[number]

export type ExternalStorybookClientSnapshot = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>

export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]

export type ExternalStorybookGraph = Zavx0zStorybookPackageGraphCreate.Output

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

export type StorybookPackageRevisionAncestor = ReturnType<Zavx0zStorybookPackageRevision.Output["create"]>["ancestors"][number]

export type StorybookBreadcrumbScope =
  | Readonly<{kind: "landing"}>
  | Readonly<{
    kind: "package"
    ancestors: readonly StorybookPackageRevisionAncestor[]
  }>
