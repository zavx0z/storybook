import type {Zavx0zStorybookAppWebPageAgentBridge} from "@zavx0z/storybook-app-web-page-agent-bridge"
import type {ExternalStorybookClientSnapshot} from "../contract/types"

export type ExternalStorybookClientPackageSummary = ExternalStorybookClientSnapshot["packages"][number]

export type StorybookAgentBridge = Zavx0zStorybookAppWebPageAgentBridge.Output

export type ScrollableStorybookElement = {
  scrollTop: number
  scrollLeft: number
}
