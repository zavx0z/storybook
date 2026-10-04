import {useSyncExternalStore} from "@zavx0z/immersive-component"
import type {Zavx0zStorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import type {Zavx0zStorybookAppWebPageShellMinimap} from "@zavx0z/storybook-app-web-page-shell-minimap"
type MinimapInitialState = NonNullable<Zavx0zStorybookAppWebPageShellMinimap.Input["initialState"]>
type MinimapState = Zavx0zStorybookAppWebPageShellMinimap.Output
import Minimap from "@zavx0z/storybook-app-web-page-shell-minimap"

/** Подписывает HUD на ту же модель каталога, что обслуживает Display. */
export function WorkbenchMinimap(props: Readonly<{
  workbench: Zavx0zStorybookAppWebPageShellWorkbench.Output
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
