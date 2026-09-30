/** Сохраняет не более limit байтов, но продолжает дренировать pipe до EOF. */
export default async function readBoundedChildStream(
  stream: unknown,
  limit: number,
): Promise<string> {
  if (stream === null || stream === undefined || typeof stream === "number") return ""
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (length >= limit) continue
      const remaining = limit - length
      const chunk = next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining)
      chunks.push(chunk)
      length += chunk.byteLength
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }
  const value = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    value.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(value)
}
