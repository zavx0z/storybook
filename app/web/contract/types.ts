import type {AppWebBuild} from "@app-web/build"
import type {AppWebProtocol} from "@app-web/protocol"
import type {WebRelease} from "@web/release"

export type WebAssets = Awaited<ReturnType<AppWebBuild.Output["buildAssets"]>>
export type WebHost = Awaited<ReturnType<AppWebProtocol.Output["readSharedHost"]>>
export type WebState = ReturnType<WebRelease.Output["read"]>
export type WebFailure = Readonly<{message: string, at: string}>

export type WebEvent = Readonly<{type: "shared.updated", host: WebHost, entry: string}>
  | Readonly<{type: "shared.failed", message: string}>
  | Readonly<{type: "shared.cache-progress", state: "started" | "completed", hit?: boolean}>
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
