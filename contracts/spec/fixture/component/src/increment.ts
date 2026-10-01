interface Calculation {
  readonly step: number
}

export function stepOf(step?: number): number {
  const calculation: Calculation = {step: step ?? 1}
  return calculation.step
}
