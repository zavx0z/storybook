/** Контролируемый encoder малого fixture PNG; native Headless decoder остаётся настоящим. */
export const fixtureImageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const png = Uint8Array.from(atob(fixtureImageData), character => character.charCodeAt(0))
export const fixtureImageDraws: Readonly<{sourceWidth: number, sourceHeight: number, width: number, height: number}>[] = []
export const fixtureImageEncodings: Blob[] = []
export const fixtureDecodedEncodings: Readonly<{width: number, height: number}>[] = []

/** Для картинки1×1 resizing не требуется; encode возвращает действительный исходный PNG. */
export function installFixtureImageEncoder(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas")
  class FixtureOffscreenCanvas {
    constructor(public width: number, public height: number) {}
    getContext(kind: string) {
      if (kind !== "2d") return null
      return {drawImage: (source: ImageBitmap, _x: number, _y: number, width: number, height: number) => {
        if (source.width !== 1 || source.height !== 1 || width !== 1 || height !== 1) throw new Error("One-pixel fixture must draw the actual decoded PNG at1×1")
        fixtureImageDraws.push({sourceWidth: source.width, sourceHeight: source.height, width, height})
      }}
    }
    async convertToBlob(): Promise<Blob> {
      if (this.width !== 1 || this.height !== 1) throw new Error("Fixture encoder requires1×1 canvas")
      const blob = new Blob([png], {type: "image/png"})
      // Метод вызывается внутри Headless operation, где установлен actual decoder.
      const decoded = await globalThis.createImageBitmap(blob)
      try {fixtureDecodedEncodings.push({width: decoded.width, height: decoded.height})}
      finally {decoded.close()}
      fixtureImageEncodings.push(blob)
      return blob
    }
  }
  Object.defineProperty(globalThis, "OffscreenCanvas", {value: FixtureOffscreenCanvas, configurable: true, writable: true})
  let restored = false
  return () => {
    if (restored) return
    restored = true
    if (previous) Object.defineProperty(globalThis, "OffscreenCanvas", previous)
    else Reflect.deleteProperty(globalThis, "OffscreenCanvas")
  }
}
