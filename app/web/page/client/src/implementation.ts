import WebProtocol from "@zavx0z/storybook-app-web-protocol"
import type {ExternalStorybookClientSnapshot} from "../contract/types"

export function validateClientSnapshot(value: unknown): ExternalStorybookClientSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("External Storybook client snapshot must be an object")
  }
  const snapshot = value as Partial<ExternalStorybookClientSnapshot>
  if (snapshot.protocol !== WebProtocol.clientProtocol) {
    throw new Error(`Unsupported external Storybook client protocol: ${String(snapshot.protocol)}`)
  }
  if (typeof snapshot.projectName !== "string" || snapshot.projectName.trim().length === 0 ||
    typeof snapshot.graphDigest !== "string" || snapshot.graphDigest.length === 0 ||
    !Array.isArray(snapshot.rootIds) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.packages)) {
    throw new Error("External Storybook client snapshot is incomplete")
  }
  const ids = new Set<string>()
  for (const node of snapshot.nodes) {
    if (node === null || typeof node !== "object" || typeof node.id !== "string" || ids.has(node.id) ||
      !Array.isArray(node.childIds) || !Array.isArray(node.searchTerms) ||
      typeof node.resourceUrl !== "string" || !["package", "directory", "entry", "unavailable"].includes(node.kind)) {
      throw new Error(`Invalid external Storybook client node: ${String(node?.id)}`)
    }
    ids.add(node.id)
  }
  for (const rootId of snapshot.rootIds) {
    if (typeof rootId !== "string" || !ids.has(rootId)) {
      throw new Error(`Unknown external Storybook client root: ${String(rootId)}`)
    }
  }
  return snapshot as ExternalStorybookClientSnapshot
}
