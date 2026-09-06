import {Markdown, type MarkdownProps} from "@zavx0z/ui/views/markdown"
import {StorybookOverviewActionButton} from "./components/overview-action-button.tsx"
import type {StorybookOverviewAction} from "./components/overview-action.ts"

export type StorybookMarkdownViewProps = Pick<MarkdownProps, "source" | "baseUrl" | "wrap"> & Readonly<{
  action?: StorybookOverviewAction
}>

/** Storybook owns the overview action and its shared scrolling viewport. */
export function StorybookMarkdownView(props: StorybookMarkdownViewProps) {
  return <section
    data-storybook-markdown=""
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      padding: 12px;
      overflow: auto;
    `}
  >
    <Markdown
      source={props.source}
      wrap={props.wrap}
      baseUrl={props.baseUrl}
      style={css`
        flex-shrink: 0;
        overflow: visible;
      `}
    />
    {props.action === undefined ? null : <StorybookOverviewActionButton
      action={props.action}
    />}
  </section>
}
