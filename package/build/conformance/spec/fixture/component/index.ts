/**
Возвращает авторскую подпись примера без побочных эффектов.

@packageDocumentation
*/
export default function label(props: {name: string}): string {
  return `Label: ${props.name}`
}
