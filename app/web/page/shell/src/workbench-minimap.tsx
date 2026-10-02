import {useSyncExternalStore} from "@zavx0z/component"
import type {WebWorkbenchModel} from "@web/workbench-model"
import type {WebMinimap} from "@web/minimap"
type MinimapState = NonNullable<WebMinimap.Input["initialState"]>
import Minimap from "@web/minimap"

/** Подписывает HUD на ту же модель каталога, что обслуживает Display. */
export function WorkbenchMinimap(props: Readonly<{
  model: WebWorkbenchModel.Output
  initialState?: MinimapState | undefined
  onStateChange?: ((state: MinimapState) => void) | undefined
  onRebuildWeb?: (() => Promise<void>) | undefined
}>) {
  const view = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot)
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
