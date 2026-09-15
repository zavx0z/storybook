import {useState} from "@zavx0z/component"

/** Компонент с локальным состоянием для проверки сохранения экземпляра. */
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
