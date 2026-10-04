import {useSyncExternalStore} from "@immersive/component"
import type {StorybookAppWebPageShellWorkbench} from "@storybook-app-web-page-shell/workbench"
import type {StorybookAppWebPageShellMinimap} from "@storybook-app-web-page-shell/minimap"
type MinimapInitialState = NonNullable<StorybookAppWebPageShellMinimap.Input["initialState"]>
type MinimapState = StorybookAppWebPageShellMinimap.Output
import Minimap from "@storybook-app-web-page-shell/minimap"

/** Подписывает HUD на ту же модель каталога, что обслуживает Display. */
export function WorkbenchMinimap(props: Readonly<{
  workbench: StorybookAppWebPageShellWorkbench.Output
  initialState?: MinimapInitialState | undefined
  onStateChange?: ((state: MinimapState) => void) | undefined
  onRebuildWeb?: (() => Promise<void>) | undefined
}>) {
  const view = useSyncExternalStore(props.workbench.subscribe, props.workbench.getSnapshot)
  return <Minimap
    projectName={view.state.projectName}
    initialState={props.initialState}
    onStateChange={props.onStateChange}
    onRebuildWeb={props.onRebuildWeb}
    catalog={{
      label: view.state["catalog.label"],
      management: view.state["catalog.management"],
      search: view.state["catalog.search"],
      items: view.state["catalog.items"],
      activeId: view.state["catalog.active"],
      onAction: view.onCatalogAction,
      onNavigate: view.onCatalogNavigate,
      onSearch: view.onCatalogSearch,
      onGroupToggle: view.onGroupToggle,
      navigationExpansion: view.navigationExpansion,
    }}
  />
}
