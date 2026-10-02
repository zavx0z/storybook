/**
Собирает именованный API Web-области приложения из публичных входов её владельцев.
Выпуск интерфейса принадлежит Release, подготовка артефактов и browser-входы — Build.
Page связывает жизненные циклы Shell, Home и Package в одном Experience; Workbench
и его модель удерживают согласованные области просмотра и Inspector.
Компоненты каталога, окон, управления ViewPoint, транспорта и представлений
сохраняют собственные реализации, контракты и время жизни.

@packageDocumentation
*/
export {default as AgentBridge} from "@web/agent-bridge"
export type {WebAgentBridge} from "@web/agent-bridge"
export {default as Bootstrap} from "@web/bootstrap"
export type {WebBootstrap} from "@web/bootstrap"
export {default as BrowserFixture} from "@web/browser-fixture"
export type {WebBrowserFixture} from "@web/browser-fixture"
export {default as Build} from "@app-web/build"
export type {AppWebBuild} from "@app-web/build"
export {default as Catalog} from "@web/catalog"
export type {WebCatalog} from "@web/catalog"
export {default as Client} from "@web/client"
export type {WebClient} from "@web/client"
export {default as McpWindow} from "@web/mcp-window"
export type {WebMcpWindow} from "@web/mcp-window"
export {default as Minimap} from "@web/minimap"
export type {WebMinimap} from "@web/minimap"
export {default as Navigation} from "@web/navigation"
export type {WebNavigation} from "@web/navigation"
export {default as Page} from "@web/page"
export type {WebPage} from "@web/page"
export {default as PageTarget} from "@web/page-target"
export type {WebPageTarget} from "@web/page-target"
export {default as Presentation} from "@web/presentation"
export type {WebPresentation} from "@web/presentation"
export {default as Protocol} from "@app-web/protocol"
export type {AppWebProtocol} from "@app-web/protocol"
export {default as Reference} from "@web/reference"
export type {WebReference} from "@web/reference"
export {default as Release} from "@web/release"
export type {WebRelease} from "@web/release"
export {createScenarioApp, Inspector, Preview, Result} from "@web/scenario"
export type {ScenarioModel, ScenarioInspector, ScenarioPreview, ScenarioResult} from "@web/scenario"
export {default as Status} from "@web/status"
export type {WebStatus} from "@web/status"
export {default as StyleSheets} from "@web/style-sheets"
export type {WebStyleSheets} from "@web/style-sheets"
export {default as ViewPointControls} from "@web/viewpoint-controls"
export type {WebViewpointControls} from "@web/viewpoint-controls"
export {default as ViewPointTab} from "@web/viewpoint-tab"
export type {WebViewpointTab} from "@web/viewpoint-tab"
export {default as Workbench} from "@web/workbench"
export type {WebWorkbench} from "@web/workbench"
export {default as WorkbenchModel} from "@web/workbench-model"
export type {WebWorkbenchModel} from "@web/workbench-model"
