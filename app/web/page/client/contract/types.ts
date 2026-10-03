import type {AppWebProtocol} from "@app-web/protocol"
export type ExternalStorybookClientSnapshot = ReturnType<AppWebProtocol.Output["clientSnapshot"]>
export type ExternalStorybookClientNode = ExternalStorybookClientSnapshot["nodes"][number]
