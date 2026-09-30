/** Наблюдатель не меняет исход исполнения и не прерывает освобождение ресурсов. */
export default function notifyObserver<Event>(
  listener: ((event: Event) => void) | undefined,
  event: Event,
): void {
  try {
    listener?.(event)
  } catch {
    // Жизненным циклом владеет исполнитель, а не наблюдатель.
  }
}
