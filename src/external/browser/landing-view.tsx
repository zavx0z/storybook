import {Button} from "@ui/components/button"
import {Typography} from "@ui/components/typography"
import type {Event} from "@zavx0z/dom"

export type StorybookOverviewAction = Readonly<{
  label: string
  title: string
  activate(): void
}>

export type StorybookMessageViewProps = Readonly<{
  title: string
  detail: string
  action?: StorybookOverviewAction
}>

const actionStyle: CssStyle = css`
  & { width: auto; min-width: 120px; min-height: 30px; padding: 5px 10px; align-self: flex-start; }
`

/** Compiled overview/error/loading message using production UI controls. */
export function StorybookMessageView(props: StorybookMessageViewProps) {
  const onAction = (_event: Event) => props.action?.activate()
  return <article
    data-storybook-message=""
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        min-height: 180px;
        gap: 8px;
        padding: 18px;
        border: var(--border-width-control) solid var(--widget-box-outline);
        border-radius: 4px;
        background: var(--widget-box-background);
        color: var(--widget-box-content);
      }
    `}
  >
    <Typography text={props.title} variant="title" />
    <Typography text={props.detail} variant="body" />
    {props.action === undefined ? null : <Button
      label={props.action.label}
      title={props.action.title}
      aria-label={props.action.title}
      tone="primary"
      style={actionStyle}
      onClick={onAction}
    />}
  </article>
}
