/** Crosses work scheduled for the next frame and one following frame boundary. */
export function waitForStorybookFrameBoundary(
  scheduleFrame: (callback: FrameRequestCallback) => unknown = requestAnimationFrame,
): Promise<void> {
  return new Promise((resolvePromise) => {
    scheduleFrame(() => {
      scheduleFrame(() => resolvePromise())
    })
  })
}
