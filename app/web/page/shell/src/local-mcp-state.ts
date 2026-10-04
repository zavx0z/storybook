import {createMcpWindowPersistence} from "./mcp-window-persistence"
import type {LocalMcpWindowState} from "../contract/types"

/** Настройки локальных окон принадлежат адресам агентов; переход не переносит окно чужого владельца. */
export function createLocalMcpState(
  storage: () => Pick<Storage, "getItem" | "setItem">,
  address: string,
  initial: readonly LocalMcpWindowState[] = [],
) {
  const states = new Map(initial.map(item => [item.address, item.state]))
  const listeners = new Set<() => void>()
  const persistence = (address: string) => createMcpWindowPersistence(storage, `storybook.mcp-window.local.v1:${encodeURIComponent(address)}`)
  const read = (address: string) => {
    const state = states.get(address) ?? persistence(address).initialState
    if (state !== undefined) states.set(address, state)
    return {address, state}
  }
  let current = read(address)
  const publish = () => { for (const listener of listeners) listener() }
  const save = (address: string, state: LocalMcpWindowState["state"]) => {
    if (JSON.stringify(states.get(address)) === JSON.stringify(state)) return
    states.set(address, state)
    persistence(address).save(state)
    if (current.address === address) {
      current = {address, state}
      publish()
    }
  }
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select(address: string) {
      if (current.address === address) return
      current = read(address)
      publish()
    },
    setOpen(open: boolean) { save(current.address, {...current.state, open, minimized: false}) },
    save,
    capture: (): readonly LocalMcpWindowState[] => [...states].map(([address, state]) => ({address, state})),
  }
}
