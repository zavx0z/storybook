import type {AppWebProtocol} from "@app-web/protocol"

export type ExternalStorybookClientSnapshot = ReturnType<AppWebProtocol.Output["clientSnapshot"]>

export type LandingSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>
