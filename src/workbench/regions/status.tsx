import {Typography} from "@ui/components/typography"
import type {WorkbenchStatus} from "../contract.ts"

export type StatusRegionProps = Readonly<{
  status: WorkbenchStatus
}>

/** Retained Workbench status region. */
export function StatusRegion(props: StatusRegionProps) {
  return <footer
    role="status"
    aria-live="polite"
    aria-label={`${props.status.lead}${props.status.owner}${props.status.detail}`}
    data-storybook-region="status"
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        align-items: center;
        width: 100%;
        height: 24px;
        min-height: 24px;
        gap: 0;
        padding: 0 12px 0 8px;
        border-top: 2px solid var(--material-editor-border);
        background: rgb(var(--surface-950));
        overflow: clip;
      }
    `}
  >
    <Typography text={props.status.lead} variant="caption" />
    <Typography
      text={props.status.owner}
      variant="caption"
      title={props.status.owner}
      style={css`& { color: var(--widget-regular-content); }`}
    />
    <Typography text={props.status.detail} variant="caption" />
  </footer>
}
