import {CodeEditor} from "@zavx0z/immersive-ui-component"
import {Typography} from "@zavx0z/immersive-ui-component"
import type {Zavx0zStorybookAppWebPagePackageScenarioModel} from "@zavx0z/storybook-app-web-page-package-scenario-model"
/** Форма исходного публичного владельца. */
type ScenarioAppInput = Zavx0zStorybookAppWebPagePackageScenarioModel.Input
import {isScenarioGuide, ScenarioGuideResult} from "./guide"

type Call = Extract<ScenarioAppInput, {kind: "function"}>["variants"][number]["calls"][number]

/** Выбирает кодовое представление руководства либо полный JSON исхода вызова. */
export function ScenarioCallResult(props: Readonly<{key?: string, call: Call, index: number, multiple: boolean}>) {
  const outcome = props.call.outcome
  const guide = "value" in outcome && isScenarioGuide(outcome.value) ? outcome.value : null
  return <section
    data-scenario-call={String(props.call.id)}
    style={css`
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 180px;
      gap: 4px;
    `}
  >
    {props.multiple ? <Typography text={`Вызов ${props.index + 1}`} /> : null}
    {outcome.type === "throw" || outcome.type === "reject" ? <Typography text="Ошибка выполнения" /> : null}
    {guide !== null ? <ScenarioGuideResult guide={guide} /> : <CodeEditor
      languageId="json"
      readOnly={true}
      value={JSON.stringify("value" in outcome ? outcome.value : outcome.error, null, 2)}
      style={css`
        flex: 1;
        width: 100%;
        height: 100%;
        min-height: 0;
      `}
    />}
  </section>
}
