export declare namespace HmrActivation {
  /**
  Серверно выбранная цель и независимая инспекция браузера. inspect читает фактический
  кадр и новые ошибки console. commit вызывается только после полного подтверждения;
  его отсутствие означает проверку preview без публикации. Владелец commit проверяет
  актуальность lease и атомарно сохраняет working revision.
  */
  export type Input = Readonly<{
    expected: Omit<Output, "frameSequence">
    inspect(): Promise<Readonly<Record<string, unknown>>>
    commit?(evidence: Output): void | Promise<void>
    signal: AbortSignal
  }>

  /** Точная идентичность показанной ревизии и номер подтверждённого кадра. */
  export type Output = Readonly<{
    packageId: string
    revision: string
    route: string
    graphDigest: string
    frameSequence: number
  }>
}
