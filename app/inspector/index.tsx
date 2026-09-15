import {ScenarioVariant} from "./src/variant"
import {useSyncExternalStore} from "@zavx0z/component"
import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import type {ScenarioApp} from "../contract/output"

/** Один Editor с декларацией и аккордеон пунктов выбранного варианта. */
export function ScenarioInspector(props: Readonly<{value: unknown}>) {
  const app = props.value as ScenarioApp
  const selected = useSyncExternalStore(app.subscribe, app.getSnapshot)
  return <section
    data-scenario-inspector=""
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      gap: 6px;
    `}
  >
    <CodeEditor
      title="Декларация компонента"
      languageId="typescript"
      readOnly={true}
      value={selected.source}
      style={css`
        width: 100%;
        height: 260px;
        min-height: 180px;
      `}
    />
    {app.variants.map(variant => <ScenarioVariant
      key={variant.id}
      app={app}
      variant={variant}
      expanded={selected.id === variant.id}
    />)}
  </section>
}
