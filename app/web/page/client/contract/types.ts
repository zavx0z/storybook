import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
export type ExternalStorybookClientSnapshot = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>
export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]
