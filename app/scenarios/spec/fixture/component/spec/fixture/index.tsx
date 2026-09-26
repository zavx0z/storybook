import {Command, type CommandProps} from "@fixture/scenario-component"

/** Общая декларация команды для выполнения сценария и просмотра его вариантов. */
export function CommandFixture(props: CommandProps) {
  return <Command
    label={props.label}
    disabled={props.disabled}
  />
}
