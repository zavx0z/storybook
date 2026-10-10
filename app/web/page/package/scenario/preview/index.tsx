/** Представление сценария: preview; использует модель владельца выбора и один общий Experience.

@packageDocumentation
*/
import type {StorybookAppWebPagePackageScenarioPreview as Contract} from "./contract"
export type {StorybookAppWebPagePackageScenarioPreview} from "./contract"
import {useSyncExternalStore} from "@zavx0z/immersive/XReact"
import StorybookAppWebPagePackageScenarioResult from "@zavx0z/storybook-app-web-page-package-scenario-result"
/**
Предоставляет место общей фикстуре в существующем Display.
Host подключает компонент к stage один раз и обновляет его props отдельно.
Во время проверки stage скрыт, вместо него показывается ход выполнения или ошибка.
*/
export default function StorybookAppWebPagePackageScenarioPreview(props: Contract.Input) {
  const selected = useSyncExternalStore(props.app.subscribe, props.app.getSnapshot)
  const visible = selected.assertion === undefined && (selected.execution === undefined || selected.execution.status === "passed")
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
    {!visible ? <StorybookAppWebPagePackageScenarioResult app={props.app} /> : null}
  </section>
}
