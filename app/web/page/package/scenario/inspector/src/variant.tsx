import {useSyncExternalStore} from "@zavx0z/immersive-component"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import {Typography} from "@zavx0z/immersive-ui-component"
import type {StorybookAppWebPagePackageScenarioModel} from "@zavx0z/storybook-app-web-page-package-scenario-model"
/** Форма исходного публичного владельца. */
type ScenarioApp = StorybookAppWebPagePackageScenarioModel.Output
/** Вариант и его пункты из подготовленного снимка сценария. */
type Variant = ScenarioApp["variants"][number]


type Assertion = NonNullable<Variant["points"][number]["assertions"]>[number]

/** Выбираемый лист инспектора, без монтажа содержимого проверки внутри дерева. */
function AssertionPoint(props: Readonly<{key?: string; assertion: Assertion; app: ScenarioApp; selectedId?: string | undefined; running: boolean}>) {
  const assertion = props.assertion
  return <button
      type="button"
      aria-pressed={props.selectedId === assertion.id}
      disabled={props.running}
      onClick={() => props.app.selectAssertion(assertion.id)}
      style={css`
        display: block;
        width: 100%;
        min-width: 0;
        padding: 6px 8px;
        text-align: left;
        white-space: normal;
        color: inherit;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;

        &:hover {
          background: #3a3a3a;
        }

        &[aria-pressed="true"] {
          background: #344b65;
          border-color: #6f9dce;
        }
      `}
    >
      {assertion.label}
    </button>
}


function AssertionList(props: Readonly<{point: Variant["points"][number]; app: ScenarioApp; selectedId?: string | undefined; running: boolean}>) {
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 2px;
    `}
  >
    {props.point.assertions!.map(assertion => <AssertionPoint
      key={assertion.id}
      assertion={assertion}
      app={props.app}
      selectedId={props.selectedId}
      running={props.running}
    />)}
  </div>
}

/** Один пункт документации раскрытого варианта. */
function ScenarioPoint(props: Readonly<{key?: string; point: Variant["points"][number]; app: ScenarioApp; selectedId?: string | undefined; running: boolean}>) {
  return <section style={css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `}>
    <Typography text={props.point.title} />
    {(props.point.assertions?.length ?? 0) > 0 ? <AssertionList
      point={props.point}
      app={props.app}
      selectedId={props.selectedId}
      running={props.running}
    /> : null}
    {(props.point.assertions?.length ?? 0) === 0 && props.point.content ? <Typography text={props.point.content} variant="caption" /> : null}
  </section>
}

/** Пункты передаются в Panel как компонент с собственной разметкой. */
function ScenarioPoints(props: Readonly<{variant: Variant; app: ScenarioApp}>) {
  const selected = useSyncExternalStore(props.app.subscribe, props.app.getSnapshot)
  const points = selected.id === props.variant.id ? selected.points : props.variant.points
  return <div style={css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `}>
    {points.map((point, index) => <ScenarioPoint
      key={String(index)}
      point={point}
      app={props.app}
      selectedId={selected.assertion?.id}
      running={selected.execution?.status === "running"}
    />)}
  </div>
}

/** Управляемая секция: открытие выбирает вариант в общем состоянии App. */
export function ScenarioVariant(props: Readonly<{key?: string; app: ScenarioApp; variant: Variant; expanded: boolean; label?: string}>) {
  return <Panel
    label={props.label ?? props.variant.title}
    expanded={props.expanded}
    onToggle={() => props.app.select(props.variant.id)}
  >
    <ScenarioPoints variant={props.variant} app={props.app} />
  </Panel>
}
