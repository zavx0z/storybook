import {Button} from "@zavx0z/immersive/ui"
import type {StorybookOverviewAction} from "../../contract/overview-action.ts"

export type StorybookOverviewActionButtonProps = Readonly<{
  action: StorybookOverviewAction
}>

/** Shared production action used by Storybook overview presentations. */
export function StorybookOverviewActionButton(props: StorybookOverviewActionButtonProps) {
  const onClick = (_event: Event) => props.action.activate()
  return <div
    data-storybook-overview-action=""
    style={css`
      display: flex;
      flex-direction: row;
    `}
  >
    <Button
      label={props.action.label}
      title={props.action.title}
      aria-label={props.action.title}
      tone="primary"
      size="large"
      onClick={onClick}
    />
  </div>
}
