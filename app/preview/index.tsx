import {useSyncExternalStore} from "@zavx0z/component"
import type {ScenarioApp} from "../contract/output"
import {ScenarioResult} from "../result"

/** Положение общей сцены, вычисленное host по фактическим границам компонента. */
export type ScenarioPreviewPlacement = Readonly<{x: number; y: number}>

/**
Предоставляет место общей фикстуре в существующем Display.
Host подключает компонент к stage один раз и обновляет его props отдельно.
Во время проверки stage скрыт, вместо него показывается ход выполнения или ошибка.
*/
export function ScenarioPreview(props: Readonly<{
  placement: ScenarioPreviewPlacement
  app: ScenarioApp
}>) {
  const selected = useSyncExternalStore(props.app.subscribe, props.app.getSnapshot)
  const visible = selected.execution === undefined || selected.execution.status === "passed"
  return <section
    data-scenario-preview=""
    style={css`
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    `}
  >
    <div
      data-scenario-stage=""
      data-hidden={visible ? "false" : "true"}
      style={css`
        position: relative;
        width: 100%;
        height: 100%;

        --scenario-x: ${props.placement.x}px;
        --scenario-y: ${props.placement.y}px;

        transform: translate(var(--scenario-x), var(--scenario-y));

        &[data-hidden="true"] {
          display: none;
        }
      `}
    ></div>
    {!visible ? <ScenarioResult app={props.app} /> : null}
  </section>
}
