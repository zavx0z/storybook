/** Состояние переключателя workspace; навигацией по событиям окружения владеет Page. */
export function createEnvironmentFollowState(storage: () => Storage, initial?: boolean) {
  const key = "storybook.follow-environment.v1"
  let enabled = initial ?? false
  if (initial === undefined) {
    try { enabled = storage().getItem(key) === "true" } catch {}
  }
  const listeners = new Set<() => void>()
  const set = (value: boolean) => {
    if (typeof value !== "boolean") throw new TypeError("Follow environment state must be boolean")
    if (enabled === value) return
    enabled = value
    try { storage().setItem(key, String(value)) } catch {}
    for (const listener of listeners) listener()
  }
  return Object.freeze({
    getSnapshot: () => enabled,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}},
    set,
    toggle: () => set(!enabled),
    dispose: () => listeners.clear(),
  })
}
