import {useCallback, useState} from "@zavx0z/immersive/XReact"
import {Tab} from "@zavx0z/immersive/ui"
import {WindowControl} from "@zavx0z/immersive/ui"
import McpWindow, {type StorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"
import type {StorybookAppProps} from "./application-props"
import type {GlobalMcpWindowState} from "../contract/types"

/** Общее окно всех агентов принадлежит HUD того же Experience и открывается через Tab. */
export function GlobalMcpWindow(props: Pick<StorybookAppProps, "mcpWindowState" | "saveMcpWindowState" | "loadMcpRequests">) {
  const [open, setOpen] = useState(() => props.mcpWindowState?.minimized !== true && props.mcpWindowState?.open === true)
  const [tab, setTab] = useState(() => tabPosition(props.mcpWindowState))
  const save = useCallback((state: StorybookAppWebPageShellMcpWindow.Output) => {
    props.saveMcpWindowState?.({...state, tab})
  }, [props.saveMcpWindowState, tab])
  return <>
    <McpWindow
      id="storybook-global-mcp-window"
      title="Общий журнал вызовов"
      journalOnly={true}
      open={open}
      onClose={() => setOpen(false)}
      load={props.loadMcpRequests}
      initialState={props.mcpWindowState}
      onStateChange={save}
    />
    <div
      data-global-mcp-tab=""
      data-hud-window-dock=""
      hidden={open}
      style={css`
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;

        &[hidden] {
          display: none;
        }
      `}
    >
      <Tab
        label="Все вызовы"
        position={tab}
        onPositionChange={(position, phase) => { if (phase === "end") setTab(position) }}
      >
        <WindowControl
          windowId="storybook-global-mcp-window"
          label="Общий журнал вызовов"
          open={open}
          onOpenChange={setOpen}
        />
      </Tab>
    </div>
  </>
}

function tabPosition(state: GlobalMcpWindowState | undefined): NonNullable<GlobalMcpWindowState["tab"]> {
  const edge = state?.tab?.edge
  const offset = state?.tab?.offset
  return {
    edge: edge === "left" || edge === "top" || edge === "bottom" ? edge : "right",
    offset: typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : .25,
  }
}
