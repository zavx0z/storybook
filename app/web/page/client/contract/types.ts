import type {StorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
export type ExternalStorybookClientSnapshot = ReturnType<StorybookAppWebProtocol.Output["clientSnapshot"]>
export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]
