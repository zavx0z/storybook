import {CodeEditor} from "@zavx0z/immersive/ui"
import {Typography} from "@zavx0z/immersive/ui"

/** Один исходный пример руководства с собственным заголовком и редактором. */
export function ScenarioGuideExample(props: Readonly<{key?: string, title: string, code: string}>) {
  const height = Math.min(320, Math.max(56, props.code.split("\n").length * 16 + 20))
  return <section
    data-guide-example=""
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      gap: 6px;
    `}
  >
    <Typography text={props.title} />
    <CodeEditor
      languageId="tsx"
      readOnly={true}
      value={props.code}
      style={css`
        width: 100%;
        height: ${height}px;
        min-height: 56px;
        flex-shrink: 0;
      `}
    />
  </section>
}
