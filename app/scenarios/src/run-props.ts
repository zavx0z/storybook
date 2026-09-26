/** Проверяет параметры до JSON-передачи, исключая незаметную потерю данных. */
export function validateRunProps(props: Readonly<Record<string, unknown>>): void {
  const ancestors = new Set<object>()
  const visit = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return
    if (typeof value !== "object" || value === null
      || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      || ancestors.has(value)) throw new TypeError("props допускает только JSON-данные без циклов")
    ancestors.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("props допускает только перечисляемые поля данных")
      }
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)) {
        throw new TypeError("Массив props не может содержать дополнительные поля")
      }
      visit(descriptor.value)
    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length) {
      throw new TypeError("Массив props не может содержать пропуски")
    }
    ancestors.delete(value)
  }
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    throw new TypeError("props должен быть объектом именованных параметров")
  }
  visit(props)
}
