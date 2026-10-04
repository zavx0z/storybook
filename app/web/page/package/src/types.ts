import type {StorybookAppWebPageAgentBridge} from "@storybook-app-web-page/agent-bridge"
import type {ExternalStorybookClientSnapshot} from "../contract/types"

export type ExternalStorybookClientPackageSummary = ExternalStorybookClientSnapshot["packages"][number]

export type StorybookAgentBridge = StorybookAppWebPageAgentBridge.Output

export type ScrollableStorybookElement = {
  scrollTop: number
  scrollLeft: number
}
