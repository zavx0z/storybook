import type {ActivationOutput} from "./output"

/**
Серверно выбранная цель и независимая инспекция браузера. inspect читает фактический
кадр и новые ошибки console. commit вызывается только после полного подтверждения;
его отсутствие означает проверку preview без публикации. Владелец commit проверяет
актуальность lease и атомарно сохраняет working revision.
*/
export type ActivationInput = Readonly<{
  expected: Omit<ActivationOutput, "frameSequence">
  inspect(): Promise<Readonly<Record<string, unknown>>>
  commit?(evidence: ActivationOutput): void | Promise<void>
  signal: AbortSignal
}>
