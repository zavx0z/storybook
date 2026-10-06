import {useSyncExternalStore} from "@zavx0z/immersive-component"
import type {StorybookAppWebPageShellViewpointControls} from "@zavx0z/storybook-app-web-page-shell-viewpoint-controls"
import type {WorkbenchChatContext} from "../../contract/workbench"
import {ChatWidget} from "../../src/inspector/chat-widget"

export type ChatWidgetLifecycleProps = Readonly<{
  context: WorkbenchChatContext
  controls: StorybookAppWebPageShellViewpointControls.Output
  rendered(): void
  height?: number
  hidden?: boolean
  collapseHistory?: boolean
}>

/** Настоящий ChatWidget сохраняет обе подписки; сторонний store запускает синхронный flush перед unmount. */
export default function ChatWidgetLifecycle(props: ChatWidgetLifecycleProps) {
  const controls = useSyncExternalStore(props.controls.subscribe, props.controls.getSnapshot)
  props.rendered()
  return <div
    data-viewpoint-ready={String(controls.ready)}
    hidden={props.hidden}
    data-collapse-history={props.collapseHistory ? "true" : undefined}
    style={css`
      display: flex;
      flex-direction: column;
      width: 354px;
      height: ${props.height ?? 700}px;
      min-width: 0;
      min-height: 0;

      &[hidden] {
        display: none;
      }

      &[data-collapse-history="true"] [data-chat-messages] {
        flex: 0 0 0;
        height: 0;
        max-height: 0;
        padding: 0;
      }
    `}
  >
    <ChatWidget
      value={props.context}
      expandedKeys={[]}
      onExpandedChange={() => {}}
    />
  </div>
}
