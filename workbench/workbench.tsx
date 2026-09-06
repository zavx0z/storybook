import {useLayoutEffect, useMemo, useRef, useSyncExternalStore} from "@zavx0z/component"
import {XRDisplayElement, XRSpaceElement} from "@zavx0z/space"
import type {HTMLDivElement as SemanticDiv} from "@zavx0z/dom"
import type {Workbench as WorkbenchHandle} from "./contract.ts"
import {createWorkbenchModel} from "./controller.ts"
import {WorkbenchView} from "./view.tsx"

export type WorkbenchProps = Readonly<{
  title: string
  statusOwner: string
  displayId: string
  onReady(workbench: WorkbenchHandle): void
}>

/** document привязывается компилятором к Document этого приложения, включая callbacks. */
export function Workbench(props: WorkbenchProps) {
  const element = useRef<HTMLDivElement | null>(null)
  const model = useMemo(() => createWorkbenchModel({
    document,
    initial: {
      title: props.title,
      "catalog.label": "Каталог",
      "secondary.label": "Пакеты",
      "preview.label": "Обзор",
      status: {lead: "Создано для ", owner: props.statusOwner, detail: " · External Storybook"},
    },
  }), [])
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot)
  useLayoutEffect(() => {
    const space = document.documentElement
    const display = document.getElementById(props.displayId)
    if (element.current === null || !(space instanceof XRSpaceElement) || !(display instanceof XRDisplayElement)) {
      throw new Error("Workbench requires its authored Space, Display and mounted root")
    }
    props.onReady(model.bind(element.current as unknown as SemanticDiv, {space, display}))
    return () => model.dispose()
  }, [model])
  return <WorkbenchView
    document={view.document}
    onElement={node => { element.current = node }}
    state={view.state}
    inspectorSelectedId={view.inspectorSelectedId}
    inspectorQuery={view.inspectorQuery}
    onCatalogNavigate={view.onCatalogNavigate}
    onCatalogSearch={view.onCatalogSearch}
    onGroupToggle={view.onGroupToggle}
    onSecondaryNavigate={view.onSecondaryNavigate}
    onScenario={view.onScenario}
    onInspectorCategoryChange={view.onInspectorCategoryChange}
    onInspectorQueryChange={view.onInspectorQueryChange}
    onStatusNavigate={view.onStatusNavigate}
  >
    {view.children}
  </WorkbenchView>
}
