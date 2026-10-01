/**
Возвращает связанные и специальные значения для проверки формата инспектора.

@packageDocumentation
*/
export function mixedValue(): Record<string, unknown> {
  const shared = {value: 7}
  const result: Record<string, unknown> = {
    first: shared,
    second: shared,
    "a.b": {"": shared},
    user: {$type: "reference", path: ["пользовательские данные"]},
    nestedUser: {$type: "object", first: shared, second: shared},
    absent: undefined,
    integer: 12345678901234567890n,
    numbers: [NaN, Infinity, -Infinity, -0],
    pattern: /значение/giu,
    symbol: Symbol("значение"),
    date: new Date("2026-01-01T00:00:00.000Z"),
    promise: Promise.resolve({value: "готово"}),
    access: {
      get value() {
        throw new Error("Getter не выполняется при снятии данных")
      },
    },
  }
  result.self = result
  return result
}
