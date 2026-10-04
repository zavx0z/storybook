import type {StorybookTechHmrConnection} from "@storybook-tech-hmr/connection"

/** Соединение берётся из публичного входа HMR без копирования его полей. */
type Socket = StorybookTechHmrConnection.Input["socket"]

/** Наблюдаемое соединение без сети; события доставляются тем же listener API. */
export class FixtureSocket implements Socket {
  readonly sent: string[] = []
  closed = 0
  readonly listeners = new Map<string, Set<(event: any) => void>>()
  addEventListener(type: string, listener: (event: any) => void): void {
    const callbacks = this.listeners.get(type) ?? new Set()
    callbacks.add(listener)
    this.listeners.set(type, callbacks)
  }
  removeEventListener(type: string, listener: (event: any) => void): void { this.listeners.get(type)?.delete(listener) }
  send(value: string): void { this.sent.push(value) }
  close(): void { this.closed += 1 }
  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({data})
  }
}
