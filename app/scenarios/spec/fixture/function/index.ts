/** Сводка конечных чисел; входной массив сохраняется без изменения. */
export function summarizeNumbers({values}: {values: readonly number[]}): {values: readonly number[], count: number, sum: number} {
  if (!values.every(Number.isFinite)) throw new TypeError("Ожидаются конечные числа")
  return {values: [...values], count: values.length, sum: values.reduce((sum, value) => sum + value, 0)}
}
