/** Возвращает значения и ошибку для проверки сохранности снимков вызовов. */
export async function evaluate(input: {value?: unknown, fail?: boolean, special?: boolean}) {
  if (input.fail) throw new Error("Ошибка примера")
  if (input.special) return NaN
  return input.value
}

/** Значение-функция для проверки статически подтверждённой ссылки в исходнике preview. */
export function sampleValue() {
  return "sample"
}
