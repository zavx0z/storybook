import type {BuildCacheStatus, BuildCacheLayer} from "../contract/progress"

export function validCache(value: unknown): value is Readonly<{
  status: BuildCacheStatus
  layer: BuildCacheLayer
}> {
  if (value === null || typeof value !== "object") return false
  const cache = value as Record<string, unknown>
  return ["hit", "miss", "bypass", "unknown"].includes(String(cache.status)) &&
    ["receipt", "protocol", "package", "shared"].includes(String(cache.layer))
}
