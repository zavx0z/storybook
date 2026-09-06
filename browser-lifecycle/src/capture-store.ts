import {createHash, randomBytes} from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import {join, resolve} from "node:path"
import {PNG} from "pngjs"
import type {
  StoredStorybookCapture,
  StorybookCaptureArea,
  StorybookCaptureMetadata,
} from "./contract.ts"

export type StorybookCaptureStoreOptions = Readonly<{
  root: string
  maxEntries?: number
  maxTotalBytes?: number
  ttlMs?: number
  now?: () => number
}>

type CaptureRecord = StoredStorybookCapture & Readonly<{file: string}>

/** Bounded, pathless artifact store exposed only through storybook:// capture identities. */
export class StorybookCaptureStore {
  readonly #root: string
  readonly #maxEntries: number
  readonly #maxTotalBytes: number
  readonly #ttlMs: number
  readonly #now: () => number

  constructor(options: StorybookCaptureStoreOptions) {
    this.#root = resolve(options.root)
    this.#maxEntries = positiveInteger(options.maxEntries ?? 32, "maxEntries", 1_024)
    this.#maxTotalBytes = positiveInteger(options.maxTotalBytes ?? 128 * 1024 * 1024, "maxTotalBytes", 2 ** 31)
    this.#ttlMs = positiveInteger(options.ttlMs ?? 60 * 60 * 1_000, "ttlMs", 30 * 24 * 60 * 60 * 1_000)
    this.#now = options.now ?? Date.now
    mkdirSync(this.#root, {recursive: true, mode: 0o700})
    chmodSync(this.#root, 0o700)
    this.collect()
  }

  put(png: Uint8Array, metadata: StorybookCaptureMetadata): StoredStorybookCapture {
    if (!(png instanceof Uint8Array) || png.byteLength === 0 || png.byteLength > this.#maxTotalBytes) {
      throw new Error("Storybook capture PNG size is invalid")
    }
    const dimensions = pngDimensions(png)
    assertNonEmptyPixels(png, dimensions)
    const captureId = `capture_${randomBytes(18).toString("base64url")}`
    const file = `${captureId}.png`
    const capturedAt = new Date(this.#now()).toISOString()
    const record: CaptureRecord = Object.freeze({
      captureId,
      resourceUri: `storybook://captures/${captureId}`,
      mimeType: "image/png",
      width: dimensions.width,
      height: dimensions.height,
      bytes: png.byteLength,
      sha256: createHash("sha256").update(png).digest("hex"),
      packageId: boundedText(metadata.packageId, "capture packageId", 256),
      route: boundedText(metadata.route, "capture route", 2_048, true),
      graphDigest: digestText(metadata.graphDigest, "graphDigest"),
      revision: boundedText(metadata.revision, "capture revision", 256),
      area: captureArea(metadata.area),
      ...(metadata.nodeId === undefined ? {} : {nodeId: boundedText(metadata.nodeId, "capture nodeId", 512)}),
      consoleErrors: Object.freeze([...metadata.consoleErrors].slice(0, 100)),
      capturedAt,
      file,
    })
    const pngTemporary = join(this.#root, `${captureId}.${process.pid}.png.tmp`)
    const jsonTemporary = join(this.#root, `${captureId}.${process.pid}.json.tmp`)
    const pngPath = join(this.#root, file)
    const jsonPath = join(this.#root, `${captureId}.json`)
    try {
      writeFileSync(pngTemporary, png, {flag: "wx", mode: 0o600})
      writeFileSync(jsonTemporary, `${JSON.stringify(record)}\n`, {flag: "wx", mode: 0o600})
      renameSync(pngTemporary, pngPath)
      renameSync(jsonTemporary, jsonPath)
      chmodSync(pngPath, 0o600)
      chmodSync(jsonPath, 0o600)
    } catch (error) {
      rmSync(pngTemporary, {force: true})
      rmSync(jsonTemporary, {force: true})
      rmSync(pngPath, {force: true})
      rmSync(jsonPath, {force: true})
      throw error
    }
    this.collect()
    return publicRecord(record)
  }

  read(captureId: string): Readonly<{metadata: StoredStorybookCapture; png: Uint8Array}> {
    const record = this.#record(captureId)
    const pngPath = this.#capturePath(record)
    const png = new Uint8Array(readFileSync(pngPath))
    if (png.byteLength !== record.bytes || createHash("sha256").update(png).digest("hex") !== record.sha256) {
      throw new Error(`Storybook capture artifact integrity failed: ${captureId}`)
    }
    return Object.freeze({metadata: publicRecord(record), png})
  }

  list(): readonly StoredStorybookCapture[] {
    this.collect()
    return Object.freeze(this.#records().map(publicRecord))
  }

  collect(): void {
    const now = this.#now()
    const records = this.#records().sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
    let retained = 0
    let retainedBytes = 0
    for (const record of records) {
      const expired = now - Date.parse(record.capturedAt) > this.#ttlMs
      const overEntries = retained >= this.#maxEntries
      const overBytes = retainedBytes + record.bytes > this.#maxTotalBytes
      if (expired || overEntries || overBytes) {
        this.#remove(record.captureId)
        continue
      }
      retained += 1
      retainedBytes += record.bytes
    }
    for (const name of readdirSync(this.#root)) {
      if (name.endsWith(".tmp")) rmSync(join(this.#root, name), {force: true})
    }
  }

  #records(): CaptureRecord[] {
    return readdirSync(this.#root)
      .filter((name) => /^capture_[A-Za-z0-9_-]{24}\.json$/u.test(name))
      .flatMap((name) => {
        try {
          return [this.#parseRecord(readFileSync(join(this.#root, name), "utf8"))]
        } catch {
          const captureId = name.slice(0, -".json".length)
          this.#remove(captureId)
          return []
        }
      })
  }

  #record(captureId: string): CaptureRecord {
    validateCaptureId(captureId)
    const path = join(this.#root, `${captureId}.json`)
    if (!existsSync(path)) throw new Error(`Unknown Storybook capture: ${captureId}`)
    return this.#parseRecord(readFileSync(path, "utf8"))
  }

  #parseRecord(source: string): CaptureRecord {
    const value = JSON.parse(source) as unknown
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid capture record")
    const record = value as Record<string, unknown>
    const captureId = String(record.captureId)
    validateCaptureId(captureId)
    const capturedAt = String(record.capturedAt)
    if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("Invalid capture timestamp")
    const width = positiveInteger(Number(record.width), "capture width", 1_000_000)
    const height = positiveInteger(Number(record.height), "capture height", 1_000_000)
    const bytes = positiveInteger(Number(record.bytes), "capture bytes", this.#maxTotalBytes)
    const file = String(record.file)
    if (file !== `${captureId}.png`) throw new Error("Invalid capture file identity")
    if (!Array.isArray(record.consoleErrors)) throw new Error("Invalid capture console errors")
    const parsed: CaptureRecord = Object.freeze({
      captureId,
      resourceUri: `storybook://captures/${captureId}`,
      mimeType: "image/png",
      width,
      height,
      bytes,
      sha256: digestText(record.sha256, "capture sha256"),
      packageId: boundedText(record.packageId, "capture packageId", 256),
      route: boundedText(record.route, "capture route", 2_048, true),
      graphDigest: digestText(record.graphDigest, "capture graphDigest"),
      revision: boundedText(record.revision, "capture revision", 256),
      area: captureArea(record.area),
      ...(record.nodeId === undefined ? {} : {nodeId: boundedText(record.nodeId, "capture nodeId", 512)}),
      consoleErrors: Object.freeze(record.consoleErrors.slice(0, 100)),
      capturedAt,
      file,
    })
    this.#capturePath(parsed)
    return parsed
  }

  #capturePath(record: CaptureRecord): string {
    const path = join(this.#root, record.file)
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Storybook capture PNG is missing: ${record.captureId}`)
    return path
  }

  #remove(captureId: string): void {
    if (!/^capture_[A-Za-z0-9_-]{24}$/u.test(captureId)) return
    rmSync(join(this.#root, `${captureId}.json`), {force: true})
    rmSync(join(this.#root, `${captureId}.png`), {force: true})
  }
}

export function pngDimensions(png: Uint8Array): Readonly<{width: number; height: number}> {
  if (png.byteLength < 33 || !Buffer.from(png.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Storybook capture is not a PNG")
  }
  if (Buffer.from(png.subarray(12, 16)).toString("ascii") !== "IHDR") {
    throw new Error("Storybook capture has no PNG IHDR")
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width === 0 || height === 0 || width > 1_000_000 || height > 1_000_000) {
    throw new Error("Storybook capture PNG dimensions are invalid")
  }
  return Object.freeze({width, height})
}

function assertNonEmptyPixels(
  bytes: Uint8Array,
  expected: Readonly<{width: number; height: number}>,
): void {
  let decoded: PNG
  try {
    decoded = PNG.sync.read(Buffer.from(bytes))
  } catch (error) {
    throw new Error("Storybook capture is not a decodable PNG", {cause: error})
  }
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    throw new Error("Storybook capture PNG dimensions are inconsistent")
  }
  let visible = 0
  let first: number | null = null
  let varied = false
  for (let offset = 0; offset < decoded.data.length; offset += 4) {
    const alpha = decoded.data[offset + 3]!
    if (alpha === 0) continue
    visible += 1
    const rgba = (decoded.data[offset]! << 24) | (decoded.data[offset + 1]! << 16) |
      (decoded.data[offset + 2]! << 8) | alpha
    if (first === null) first = rgba
    else if (rgba !== first) varied = true
  }
  if (visible === 0 || (!varied && expected.width * expected.height > 1)) {
    throw new Error("Storybook capture contains no non-uniform visible pixels")
  }
}

function publicRecord(record: CaptureRecord): StoredStorybookCapture {
  const {file: _file, ...metadata} = record
  return Object.freeze(metadata)
}

function validateCaptureId(value: string): void {
  if (typeof value !== "string" || !/^capture_[A-Za-z0-9_-]{24}$/u.test(value)) {
    throw new Error(`Invalid Storybook capture identity: ${String(value)}`)
  }
}

function digestText(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function captureArea(value: unknown): StorybookCaptureArea {
  if (!["page", "workbench", "preview", "canvas", "node"].includes(String(value))) {
    throw new Error(`Invalid Storybook capture area: ${String(value)}`)
  }
  return value as StorybookCaptureArea
}

function boundedText(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`Invalid ${label}`)
  return value
}
