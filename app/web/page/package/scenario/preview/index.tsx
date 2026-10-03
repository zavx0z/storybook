/** Представление сценария: preview; использует модель владельца выбора и один общий Experience.

@packageDocumentation
*/
import type {ScenarioPreview as Contract} from "./contract"
export type {ScenarioPreview} from "./contract"
import {useSyncExternalStore} from "@zavx0z/component"
import ScenarioResult from "@scenario/result"
/**
Предоставляет место общей фикстуре в существующем Display.
Host подключает компонент к stage один раз и обновляет его props отдельно.
CSS центрирует авторский размер в координатах Display независимо от масштаба обзора.
Во время проверки stage скрыт, вместо него показывается ход выполнения или ошибка.
*/
export default function ScenarioPreview(props: Contract.Input) {
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
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;

        &[data-hidden="true"] {
          display: none;
        }
      `}
    ></div>
    {!visible ? <ScenarioResult app={props.app} /> : null}
  </section>
}
