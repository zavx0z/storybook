import {useState} from "@zavx0z/component"

export type ExampleProps = Readonly<{label: string}>

/** Собственное состояние показывает сохранность шаблона и listeners при reparent. */
export function PresentationExample(props: ExampleProps) {
  const [count, setCount] = useState(0)
  return <article data-presentation-example="">
    <button onClick={() => setCount(value => value + 1)}>
      {props.label}:{count}
    </button>
  </article>
}

/** Два явных корня раскрывают отказ selector с неоднозначным результатом. */
export function MultipleRoots() {
  return <>
    <article data-presentation-example="">Первый</article>
    <article data-presentation-example="">Второй</article>
  </>
}
