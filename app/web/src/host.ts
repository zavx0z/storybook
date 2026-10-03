import Protocol from "@app-web/protocol"
import type {WebAssets, WebHost} from "../contract/types"

export function describeHost(assets: WebAssets): WebHost {
  const identity = assets.browserIdentity
  if (!identity) throw new Error("Shared host has no browser identity")
  return Protocol.validateSharedHost({protocol: "storybook-shared-host/1", sharedModuleEpoch: identity.epoch,
    hostModuleEpoch: identity.hostModuleEpoch, pageEntryUrl: identity.packageEntryUrl,
    authorStyleSheets: (assets.authorStyleSheets ?? []).map(style => ({...style, url: `/__storybook/shared/${style.url}`})),
  })
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
