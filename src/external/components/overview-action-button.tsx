import {Button} from "@ui/components/button"
import type {StorybookOverviewAction} from "./overview-action.ts"

export type StorybookOverviewActionButtonProps = Readonly<{
  action: StorybookOverviewAction
}>

/** Shared production action used by Storybook overview presentations. */
export function StorybookOverviewActionButton(props: StorybookOverviewActionButtonProps) {
  const onClick = (_event: Event) => props.action.activate()
  return <Button
    label={props.action.label}
    title={props.action.title}
    aria-label={props.action.title}
    tone="primary"
    size="large"
    onClick={onClick}
  />
}
