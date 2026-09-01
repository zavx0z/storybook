import {Pane} from "@ui/components/pane"
import {Typography} from "@ui/components/typography"
import {StorybookOverviewActionButton} from "../components/overview-action-button.tsx"
import type {StorybookOverviewAction} from "../components/overview-action.ts"

export type StorybookMessageViewProps = Readonly<{
  title: string
  detail: string
  action?: StorybookOverviewAction
}>

type StorybookMessageContentProps = Readonly<{
  title: string
  detail: string
  action: StorybookOverviewAction | undefined
}>

function StorybookMessageContent(props: StorybookMessageContentProps) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 8px;
  `}>
    <Typography text={props.title} variant="title" />
    <Typography text={props.detail} variant="body" />
    {props.action === undefined ? null : <StorybookOverviewActionButton
      action={props.action}
    />}
  </div>
}

/** Compiled overview/error/loading message using production UI controls. */
export function StorybookMessageView(props: StorybookMessageViewProps) {
  return <article
    data-storybook-message=""
    style={css`
      display: block;
      width: 100%;
      min-height: 180px;
    `}
  >
    <Pane style={css`
      width: 100%;
      min-height: 180px;
    `}>
      <StorybookMessageContent
        title={props.title}
        detail={props.detail}
        action={props.action}
      />
    </Pane>
  </article>
}
