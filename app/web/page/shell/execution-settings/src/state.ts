import type {StorybookAppWebPageShellExecutionSettings as Contract} from "../contract"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"

type Connection = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>["connections"][number]

/** Меняет только транспорт существующего подключения; прежний SSH восстанавливается из черновика формы. */
export function connectionPeer(connection: Connection, peer: Connection["peer"], previous?: Connection): Connection {
  const {peer: removed, ...local} = connection
  if (local.provider === "ollama") {
    const {ssh, ...endpoint} = local.endpoint
    const retained = (previous?.provider === "ollama" ? previous.endpoint.ssh : undefined) ?? ssh
    return peer === undefined
      ? {...local, endpoint: retained ? {...endpoint, ssh: retained} : endpoint}
      : {...local, endpoint, peer}
  }
  const {ssh, ...direct} = local
  const retained = (previous?.provider === local.provider ? previous.ssh : undefined) ?? ssh
  return peer === undefined ? retained ? {...direct, ssh: retained} : direct : {...direct, peer}
}

/** Пустые или недопустимые peer IDs и смешение peer/SSH отклоняются до запроса сохранения. */
export function connectionPeerError(connections: readonly Connection[]): string {
  const identity = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
  for (const connection of connections) {
    if (connection.peer === undefined) continue
    if (!connection.peer.peerId.trim()) return `«${connection.label}»: укажите участника.`
    if (!connection.peer.executorId.trim()) return `«${connection.label}»: укажите исполнителя.`
    if (!identity.test(connection.peer.peerId) || !identity.test(connection.peer.executorId)) {
      return `«${connection.label}»: идентификаторы допускают 1–256 букв ASCII, цифр и . _ : -; первый символ — буква или цифра.`
    }
    if (connection.provider === "ollama" ? connection.endpoint.ssh !== undefined : connection.ssh !== undefined) {
      return `«${connection.label}»: пир и SSH нельзя использовать одновременно.`
    }
  }
  return ""
}

/** Проверяет сохранённое положение; ограничение видимыми границами выполняет Window. */
export function windowState(input: Contract.Input["initialState"]): Parameters<NonNullable<Contract.Input["onStateChange"]>>[0] {
  const geometry = {x: 80, y: 60, width: 780, height: 540}
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = input?.geometry?.[key]
    if (typeof value === "number" && Number.isFinite(value)) geometry[key] = Math.max(key === "width" ? 520 : key === "height" ? 320 : 0, value)
  }
  const edge = input?.tab?.edge
  const offset = input?.tab?.offset
  return {open: input?.open === true, geometry, tab: {
    edge: edge === "bottom" || edge === "left" || edge === "right" ? edge : "top",
    offset: typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : .72,
  }}
}
