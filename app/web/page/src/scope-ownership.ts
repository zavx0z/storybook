type Scope = Readonly<{controller: Readonly<{shell: unknown}>}>

/** Captured shell и зарегистрированный scope определяют владельца, даже при повторном same-id. */
export function createScopeOwnership<S extends Scope>(options: Readonly<{
  shell: unknown
  signal: AbortSignal
  generation: number
  readGeneration(): number
  readOwner(): unknown
  selected(): Scope | null
  live(): boolean
}>) {
  let bound: S | null = null
  const owns = () => options.live() && !options.signal.aborted && (bound === null
    ? options.generation === options.readGeneration()
    : options.readOwner() === bound && bound.controller.shell === options.shell)
  return {
    bind(scope: S) {bound = scope},
    owns,
    scope: () => owns() ? bound : null,
    selected() {
      const selected = options.selected()
      return owns() && selected?.controller.shell === options.shell && (bound === null || selected === bound)
    },
  }
}
