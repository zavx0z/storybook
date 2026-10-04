import {useState} from "@zavx0z/immersive-component"

/** Локальное состояние подтверждает сохранение экземпляра при выборе варианта. */
export function StatefulFixture(props: Readonly<{name: string}>) {
  const [count, setCount] = useState(0)
  return <button
    data-fixture=""
    data-variant={props.name}
    onClick={() => setCount(value => value + 1)}
  >
    {`${props.name}: ${count}`}
  </button>
}

/** Родитель сохраняет свой semantic Element при смене children в подготовленном результате. */
export function ChildrenFixture(props: Readonly<{
  label: string | null
  children?: import("@zavx0z/immersive-jsx-compiler-session").JSX.Element | null | undefined
}>) {
  return <section data-container="">
    <span>{props.label}</span>
    {props.children}
  </section>
}

export function Content() {
  return <span data-badge="">Дочерний компонент</span>
}

/** Авторский размер фикстуры сохраняется при любом масштабе проекции. */
export function FixedSizeFixture(props: Readonly<{absolute: boolean}>) {
  return <div
    data-fixed-fixture=""
    style={css`
      position: ${props.absolute ? "absolute" : "relative"};
      width: 180px;
      height: 38px;
      flex-shrink: 0;
    `}
  />
}
