import type {Workbench as ModelWorkbench} from "../contract/workbench"
import type {WorkbenchViewProps as ModelViewProps} from "../contract/view"

export type WorkbenchViewProps = ModelViewProps
export type WorkbenchViewState = WorkbenchViewProps["state"]
export type Workbench = ModelWorkbench
export type WorkbenchNavigationItem = WorkbenchViewState["catalog.items"][number]
export type WorkbenchNavigationGroup = Parameters<WorkbenchViewProps["onGroupToggle"]>[0]
export type NavigationExpansion = NonNullable<WorkbenchViewProps["navigationExpansion"]>
export type WorkbenchCatalogAction = Parameters<WorkbenchViewProps["onCatalogAction"]>[0]
export type WorkbenchBreadcrumb = NonNullable<WorkbenchViewState["status"]["breadcrumbs"]>[number]
export type WorkbenchTabItem = WorkbenchViewState["tabs.items"][number]
export type WorkbenchStatus = WorkbenchViewState["status"]
export type WorkbenchPresentationProjection = WorkbenchViewState["presentation"]["projection"]
export type WorkbenchInspectorSubject = NonNullable<WorkbenchViewState["inspector.subject"]>
export type WorkbenchInspectorWidgetRegistration = WorkbenchViewState["inspector.registry"][number]
