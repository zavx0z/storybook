import {useState} from "@zavx0z/component"
import {Command} from "@fixture/scenario-component"

/** Подготовка и обработчик принадлежат тому же примеру, что и публичный компонент. */
export function StatefulFixture(props: Readonly<{label: string; disabled: boolean}>) {
  const [count, setCount] = useState(0)
  return <section onClick={() => setCount(value => value + 1)}>
    <Command
      label={props.label}
      disabled={props.disabled}
    />
    <output>{String(count)}</output>
  </section>
}
