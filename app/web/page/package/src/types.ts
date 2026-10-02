import type {WebAgentBridge} from "@web/agent-bridge"
import type {ExternalStorybookClientSnapshot} from "../contract/types"

export type ExternalStorybookClientPackageSummary = ExternalStorybookClientSnapshot["packages"][number]

export type StorybookAgentBridge = WebAgentBridge.Output

export type ScrollableStorybookElement = {
  scrollTop: number
  scrollLeft: number
}
