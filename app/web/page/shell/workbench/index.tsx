/**
Рабочая область одного Experience: каталог, вкладки, содержимое, Inspector и состояние.
Общая модель принимает данные приложения и переносит содержимое между проекциями
того же Document. Display показывает текущую ветвь, а Minimap получает полный каталог.

@packageDocumentation
*/
import {HUDElement} from "@zavx0z/dom/hud"
import {DisplayElement} from "@zavx0z/dom/display"
import {useLayoutEffect, useMemo, useRef, useSyncExternalStore} from "@zavx0z/component"
import {SpaceElement} from "@zavx0z/dom/space"
import type {HTMLDivElement as SemanticDiv} from "@zavx0z/dom"
import type {WebWorkbench} from "./contract"
export type {WebWorkbench} from "./contract"
import {WorkbenchView} from "./src/view"
import {selectWorkbenchNavigationBranch} from "./src/navigation/branch"
import {createWorkbenchModel} from "./src/model"

/**
Workbench в Display показывает каталог от текущего узла вглубь.
Это проекция полного каталога модели: HUD продолжает получать всю иерархию.
document привязывается компилятором к Document этого приложения, включая callbacks.
*/
export default function Workbench(props: WebWorkbench.Input) {
  const element = useRef<HTMLDivElement | null>(null)
  const model = useMemo(() => createWorkbenchModel({
    document,
    initial: props.initial,
    userState: props.userState,
    navigationExpansion: props.navigationExpansion,
  }), [])
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const displayState = {
    ...view.state,
    "catalog.items": selectWorkbenchNavigationBranch(view.state["catalog.items"], view.state["catalog.active"]),
  }
  useLayoutEffect(() => {
    const display = document.getElementById(props.displayId)
    const space = display?.closest("space")
    const hud = document.getElementById(props.hudId)
    if (element.current === null || !(space instanceof SpaceElement) || !(display instanceof DisplayElement) || !(hud instanceof HUDElement)) {
      throw new Error("Workbench requires its authored Space, Display and mounted root")
    }
    props.onReady(model.bind(element.current as unknown as SemanticDiv, {space, hud}))
  }, [model])
  useLayoutEffect(() => () => model.dispose(), [model])
  return <WorkbenchView
    mcpOpen={props.mcpOpen}
    onMcpOpenChange={props.onMcpOpenChange}
    document={view.document}
    onElement={node => { element.current = node }}
    state={displayState}
    navigationExpansion={view.navigationExpansion}
    inspectorSelectedId={view.inspectorSelectedId}
    inspectorQuery={view.inspectorQuery}
    onCatalogNavigate={view.onCatalogNavigate}
    onCatalogAction={view.onCatalogAction}
    onCatalogSearch={view.onCatalogSearch}
    onGroupToggle={view.onGroupToggle}
    onTab={view.onTab}
    onInspectorCategoryChange={view.onInspectorCategoryChange}
    onInspectorQueryChange={view.onInspectorQueryChange}
    onStatusNavigate={view.onStatusNavigate}
  >
    {view.children}
  </WorkbenchView>
}
