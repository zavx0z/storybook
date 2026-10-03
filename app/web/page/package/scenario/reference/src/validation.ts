import type {Asset, Compatibility, Acceptance} from "../contract/reference"
import type {Rect} from "../contract/comparison"

export function validateReferenceAsset(asset: Asset): Asset {
  if (!asset.url.startsWith("/") && !/^https?:\/\//.test(asset.url)) {
    throw new Error(`Storybook reference URL must be absolute: ${asset.url}`)
  }
  if (asset.url.includes("//") && !/^https?:\/\//.test(asset.url)) {
    throw new Error(`Storybook reference URL must be normalized: ${asset.url}`)
  }
  validateReferenceText("alt", asset.alt)
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`Storybook reference SHA-256 must be lowercase hexadecimal: ${asset.sha256}`)
  }
  return Object.freeze({
    url: asset.url,
    width: positive("reference asset width", asset.width),
    height: positive("reference asset height", asset.height),
    alt: asset.alt,
    sha256: asset.sha256,
  })
}

export function validateReferenceText(kind: string, value: string): void {
  if (value.trim().length === 0) throw new Error(`Storybook reference ${kind} must not be empty`)
}

export function isCompatibility(value: string): value is Compatibility {
  return value === "compatible" || value === "changed" || value === "unverified"
}

export function isAcceptance(value: string): value is Acceptance {
  return value === "candidate" || value === "accepted" || value === "superseded"
}

export function positive(kind: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Storybook ${kind} must be positive: ${value}`)
  return value
}

export function rect(w: number, h: number): Rect {
  return Object.freeze({x: 0, y: 0, w, h})
}
