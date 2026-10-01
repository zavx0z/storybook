import {Badge, Container} from "@fixture/scenario-component"

/** Фикстура сохраняет парные теги компонента и явную передачу children. */
export function ChildrenFixture(props: Parameters<typeof Container>[0]) {
  return <Container label={props.label}>
    {props.children}
  </Container>
}

export function Content() {
  return <Badge label="Дочерний компонент" />
}
