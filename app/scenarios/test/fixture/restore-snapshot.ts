/**
Восстанавливает связи снимка для проверки сохранности данных сериализатора.
Обычные JSON-значения и экранированные объекты возвращаются без потери полей;
прочие специальные значения остаются в описанной сериализатором форме.

@packageDocumentation
*/
export function restoreSnapshot(root: unknown): unknown {
  const restored = new Map<object, unknown>()

  const read = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value
    if (restored.has(value)) return restored.get(value)
    if (!Array.isArray(value) && Reflect.get(value, "$type") === "reference") {
      const path: unknown = Reflect.get(value, "path")
      if (!Array.isArray(path)) throw new Error("Путь ссылки не является массивом")
      let target = root
      for (const key of path) {
        if ((typeof key !== "string" && typeof key !== "number") || target === null
          || typeof target !== "object" || !Object.hasOwn(target, key)) {
          throw new Error("Ссылка указывает на отсутствующие данные")
        }
        target = Reflect.get(target, key)
      }
      return read(target)
    }
    const output = Array.isArray(value) ? [] : {}
    restored.set(value, output)
    const source = !Array.isArray(value) && Reflect.get(value, "$type") === "object"
      ? Reflect.get(value, "value") : value
    for (const [key, item] of Object.entries(source)) {
      Object.defineProperty(output, key, {
        value: read(item), enumerable: true, configurable: true, writable: true,
      })
    }
    return output
  }

  return read(root)
}
