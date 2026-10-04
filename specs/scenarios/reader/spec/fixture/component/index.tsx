import {useState} from "@zavx0z/immersive-component"

export interface CommandProps {
  readonly label: string
  readonly disabled: boolean
  readonly onActivate?: (label: string) => void
}

export function Command(props: CommandProps) {
  return <button
    type="button"
    disabled={props.disabled}
    onClick={() => props.onActivate?.(props.label)}
  >{props.label}</button>
}

/** Контейнер использует обычный children transport Template. */
export function Container(props: Readonly<{label: string | null; children?: import("@zavx0z/immersive-jsx-compiler-session").JSX.Element | null | undefined}>) {
  return <section data-container="">
    <span>{props.label}</span>
    {props.children}
  </section>
}

/** Дочерний компонент для проверки переносимости авторского JSX. */
export function Badge(props: Readonly<{label: string}>) {
  return <span data-badge="">{props.label}</span>
}

/** Команда хранит число собственных активаций. */
export function StatefulCommand(props: CommandProps) {
  const [count, setCount] = useState(0)
  return <button
    disabled={props.disabled}
    onClick={() => setCount(value => value + 1)}
  >
    {props.label}{String(count)}
  </button>
}
