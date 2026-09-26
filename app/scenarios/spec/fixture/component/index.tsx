export interface CommandProps {
  readonly label: string
  readonly disabled: boolean
}

export function Command(props: CommandProps) {
  return <button
    type="button"
    disabled={props.disabled}
  >{props.label}</button>
}
