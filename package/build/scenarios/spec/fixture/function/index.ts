/** Публичное действие фикстуры пакетного сценария. */
export default function labelAction(props: {name: string}): string {
  return `Action: ${props.name}`
}
