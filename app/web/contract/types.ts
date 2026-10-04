import type {StorybookAppWebBuild} from "@zavx0z/storybook-app-web-build"
import type {StorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {StorybookAppWebRelease} from "@zavx0z/storybook-app-web-release"

export type WebAssets = Awaited<ReturnType<StorybookAppWebBuild.Output["buildAssets"]>>
export type WebHost = Awaited<ReturnType<StorybookAppWebProtocol.Output["readSharedHost"]>>
export type WebState = ReturnType<StorybookAppWebRelease.Output["read"]>
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
