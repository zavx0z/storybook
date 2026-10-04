import type {Zavx0zStorybookAppWebBuild} from "@zavx0z/storybook-app-web-build"
import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {Zavx0zStorybookAppWebRelease} from "@zavx0z/storybook-app-web-release"

export type WebAssets = Awaited<ReturnType<Zavx0zStorybookAppWebBuild.Output["buildAssets"]>>
export type WebHost = Awaited<ReturnType<Zavx0zStorybookAppWebProtocol.Output["readSharedHost"]>>
export type WebState = ReturnType<Zavx0zStorybookAppWebRelease.Output["read"]>
export type WebFailure = Readonly<{message: string, at: string}>

export type WebEvent = Readonly<{type: "shared.updated", host: WebHost, entry: string}>
  | Readonly<{type: "shared.failed", message: string}>
  | Readonly<{type: "app.web", state: WebState}>

export type WebPreparation = Readonly<{
  ok: boolean
  shared: WebHost | undefined
  hosts: readonly WebHost[]
  packages: readonly []
  published: boolean
  applied: false
  web?: WebState
}>
