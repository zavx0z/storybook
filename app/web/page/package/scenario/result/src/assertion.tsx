import {CodeEditor} from "@zavx0z/immersive/ui"
import {Typography} from "@zavx0z/immersive/ui"
import type {StorybookAppWebPagePackageScenarioModel} from "@zavx0z/storybook-app-web-page-package-scenario-model"

type Assertion = NonNullable<ReturnType<StorybookAppWebPagePackageScenarioModel.Output["getSnapshot"]>["assertion"]>

/** Показывает выбранный снимок expect; строки остаются исходным текстом, объекты — JSON. */
export function ScenarioAssertionResult(props: Readonly<{assertion: Assertion}>) {
  const assertion = props.assertion
  return <section
      data-scenario-assertion={assertion.id}
      style={css`
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
        gap: 8px;
      `}
    >
      <Typography text={assertion.title} />
      <Typography text={assertion.label} variant="caption" />
      <CodeEditor
        languageId={typeof assertion.value === "string" ? "plaintext" : "json"}
        readOnly={true}
        value={typeof assertion.value === "string" ? assertion.value : JSON.stringify(assertion.value, null, 2) ?? "undefined"}
        style={css`
          flex: 1;
          width: 100%;
          min-width: 0;
          min-height: 0;
        `}
      />
    </section>
}
