/** Проверяет один уже декодированный сегмент канонического пути. */
export function isAddressSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.includes("/")
    && !segment.includes("\\")
    && !segment.includes("\0")
    && !/%(?:00|2f|5c)/iu.test(segment)
}
