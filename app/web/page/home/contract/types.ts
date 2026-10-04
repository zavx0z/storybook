import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"

export type ExternalStorybookClientSnapshot = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>

export type LandingSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>
