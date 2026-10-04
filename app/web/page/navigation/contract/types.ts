import type {StorybookAppWebProtocol} from "@storybook-app-web/protocol"
import type {StorybookPackageGraphCreate} from "@storybook-package-graph/create"
import type {StorybookAppWebPageShellWorkbench} from "@storybook-app-web-page-shell/workbench"
import type {StorybookPackageRevision} from "@storybook-package/revision"

export type WorkbenchBreadcrumb = NonNullable<ReturnType<StorybookAppWebPageShellWorkbench.Output["getSnapshot"]>["state"]["status"]["breadcrumbs"]>[number]

export type ExternalStorybookClientSnapshot = ReturnType<StorybookAppWebProtocol.Output["clientSnapshot"]>

export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]

export type ExternalStorybookGraph = StorybookPackageGraphCreate.Output

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

export type StorybookPackageRevisionAncestor = ReturnType<StorybookPackageRevision.Output["create"]>["ancestors"][number]

export type StorybookBreadcrumbScope =
  | Readonly<{kind: "landing"}>
  | Readonly<{
    kind: "package"
    ancestors: readonly StorybookPackageRevisionAncestor[]
  }>
