/** Точная идентичность показанной ревизии и номер подтверждённого кадра. */
export type ActivationOutput = Readonly<{
  packageId: string
  revision: string
  route: string
  graphDigest: string
  frameSequence: number
}>
