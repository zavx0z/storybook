export type BackgroundFrameScheduling = Readonly<{
  setFocusEmulation(enabled: boolean): Promise<void>
}>

/** Keeps hidden-target frame scheduling active only through one ready barrier. */
export async function runWithBackgroundFrameScheduling<T>(
  scheduling: BackgroundFrameScheduling,
  ready: () => Promise<T>,
): Promise<T> {
  let primaryFailed = false
  try {
    await scheduling.setFocusEmulation(true)
    return await ready()
  } catch (error) {
    primaryFailed = true
    throw error
  } finally {
    try {
      await scheduling.setFocusEmulation(false)
    } catch (cleanupError) {
      if (!primaryFailed) throw cleanupError
    }
  }
}
