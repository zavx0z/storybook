import {useSyncExternalStore} from "@zavx0z/component"
import type {createWorkbenchModel} from "../../controller.ts"
import type {MinimapState} from "./state.ts"
import {Minimap} from "../index.tsx"

/** Подписывает HUD на ту же модель каталога, что обслуживает Display. */
export function WorkbenchMinimap(props: Readonly<{
  model: ReturnType<typeof createWorkbenchModel>
  initialState?: MinimapState | undefined
  onStateChange?: ((state: MinimapState) => void) | undefined
}>) {
  const view = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot)
  return <Minimap
    initialState={props.initialState}
    onStateChange={props.onStateChange}
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
