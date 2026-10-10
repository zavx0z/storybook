import {SpatialTree} from "@zavx0z/immersive/nodes/spatial/tree"
import Workbench, {type StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/immersive"
import type {Document as SemanticDocument} from "@zavx0z/immersive"
import {ClipboardMenu} from "@zavx0z/immersive/ui"
import {useState} from "@zavx0z/immersive/XReact"

import {StorybookHud} from "./hud"

import type {StorybookAppProps} from "./application-props"

/** Одна сцена с правой системой координат, осью Z вверх и расстояниями в миллиметрах. */
export function StorybookApp(props: StorybookAppProps) {
  const [workbench, setWorkbench] = useState<StorybookAppWebPageShellWorkbench.Output | null>(null)
  return <space style={css`
    & [data-storybook-display-fitted="true"] {
      backdrop-filter: blur(8px);
    }
  `}>
    <viewpoint
      x={0}
      y={-1000}
      z={0}
      targetX={0}
      targetY={0}
      targetZ={0}
      far={2000}
    />
    <xr-light
      name="Освещение пространства"
      kind="directional"
      color="#ffffff"
      intensity={1}
      x={-100000}
      y={-100000}
      z={200000}
    />
    <StorybookDisplay id={props.displayId}>
      <StorybookSurface
        viewPointControls={props.viewPointControls}
        followEnvironment={props.followEnvironment}
        title={props.title}
        statusOwner={props.statusOwner}
        displayId={props.displayId}
        hudId={props.hudId}
        onReady={value => {
          setWorkbench(value)
          props.onReady(value)
        }}
        userState={props.userState}
        navigationExpansion={props.navigationExpansion}
      />
    </StorybookDisplay>
    {props.subjectGraphState === undefined ? null : <SpatialTree
      source={props.subjectGraphState}
      style={css`
        background: transparent;
        --spatial-node-surface-opacity: 0;
      `}
    />}
    <StorybookHud
      application={props}
      workbench={workbench}
    />
  </space>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет ViewPoint и поверхность. */
export function StorybookSurface(props: StorybookAppProps) {
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
  return <>
    <Workbench
      initial={{
        title: props.title,
        "catalog.label": "Каталог",
        "preview.label": "Обзор",
        status: {lead: "Создано для ", owner: props.statusOwner, detail: ""},
      }}
      userState={props.userState}
      navigationExpansion={props.navigationExpansion}
      displayId={props.displayId}
      hudId={props.hudId}
      onReady={props.onReady}
    />
    <ClipboardMenu controller={clipboard} />
  </>
}
