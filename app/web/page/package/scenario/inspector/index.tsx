/** Представление сценария: inspector; использует модель владельца выбора и один общий Experience.

@packageDocumentation
*/
import type {StorybookAppWebPagePackageScenarioInspector as Contract} from "./contract"
export type {StorybookAppWebPagePackageScenarioInspector} from "./contract"
import {ScenarioTree} from "./src/tree"
import {useSyncExternalStore} from "@zavx0z/immersive-component"
import CodeEditor from "@zavx0z/immersive-ui-component-view-code-editor"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import type {StorybookAppWebPagePackageScenarioModel} from "@zavx0z/storybook-app-web-page-package-scenario-model"
/** Форма исходного публичного владельца. */
type ScenarioApp = StorybookAppWebPagePackageScenarioModel.Output
/** Один Editor с декларацией и дерево describe с пунктами выбранного варианта. */
export default function StorybookAppWebPagePackageScenarioInspector(props: Contract.Input) {
  const app = props.value as ScenarioApp
  const selected = useSyncExternalStore(app.subscribe, app.getSnapshot)
  return <section
    data-scenario-inspector=""
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      height: 100%;
      min-height: 0;
      gap: 6px;
      overflow: hidden;
    `}
  >
    <CodeEditor
      languageId="tsx"
      readOnly={true}
      value={selected.source}
      style={css`
        width: 100%;
        height: 260px;
        min-height: 180px;
        flex-shrink: 0;
      `}
    />
    {selected.execution !== undefined ? <Button
      label="Запустить заново"
      disabled={selected.execution.status === "running"}
      onClick={() => app.run()}
    /> : null}
    <div
      data-scenario-variants=""
      style={css`
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex-grow: 1;
        gap: 6px;
        overflow-y: auto;
        scrollbar-width: thin;
      `}
    >
      <ScenarioTree
        app={app}
        selectedId={selected.id}
      />
    </div>
  </section>
}
