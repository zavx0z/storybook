/**
Pure visual-reference descriptors and equal-scale comparison planning.

Reference acquisition, storage and owner acceptance stay outside this module.
The shared contract only validates immutable evidence metadata and computes
geometry without loading assets or mutating acceptance state.

@packageDocumentation
*/

export type StorybookReferenceCompatibility = "compatible" | "changed" | "unverified"
export type StorybookReferenceAcceptance = "candidate" | "accepted" | "superseded"
export type StorybookComparisonOrientation = "horizontal" | "vertical"

export type StorybookReferenceViewport = Readonly<{
  /** Capture viewport width in CSS pixels. */
  width: number
  /** Capture viewport height in CSS pixels. */
  height: number
  /** Physical pixels per CSS pixel used by the capture. */
  devicePixelRatio: number
}>

export type StorybookReferenceAsset = Readonly<{
  /** Root-relative or HTTP(S) URL owned by the consuming Storybook app. */
  url: string
  /** Raster width in physical pixels. */
  width: number
  /** Raster height in physical pixels. */
  height: number
  alt: string
  /** Lowercase hexadecimal SHA-256 of the immutable raster bytes. */
  sha256: string
}>

export type StorybookReferenceDescriptor = Readonly<{
  id: string
  label: string
  provenance: string
  compatibility: StorybookReferenceCompatibility
  acceptance: StorybookReferenceAcceptance
  viewport: StorybookReferenceViewport
  asset: StorybookReferenceAsset
}>

export type StorybookReferenceInput = StorybookReferenceDescriptor

export type StorybookComparisonRect = Readonly<{
  x: number
  y: number
  w: number
  h: number
}>

export type StorybookComparisonPlan = Readonly<{
  orientation: StorybookComparisonOrientation
  scale: number
  subject: StorybookComparisonRect
  reference: StorybookComparisonRect
}>

/**
Validates and snapshots owner-provided visual evidence metadata.

The returned descriptor has no loader and no acceptance transition. A capture
therefore cannot become accepted as a side effect of rendering it.

@throws If identity, provenance, viewport or immutable asset metadata is invalid.
*/
export function defineStorybookReference(input: StorybookReferenceInput): StorybookReferenceDescriptor {
  validateReferenceText("id", input.id)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id)) {
    throw new Error(`Invalid Storybook reference id: ${input.id}`)
  }
  validateReferenceText("label", input.label)
  validateReferenceText("provenance", input.provenance)
  if (!isCompatibility(input.compatibility)) {
    throw new Error(`Invalid Storybook reference compatibility: ${input.compatibility}`)
  }
  if (!isAcceptance(input.acceptance)) {
    throw new Error(`Invalid Storybook reference acceptance: ${input.acceptance}`)
  }

  return Object.freeze({
    id: input.id,
    label: input.label,
    provenance: input.provenance,
    compatibility: input.compatibility,
    acceptance: input.acceptance,
    viewport: Object.freeze({
      width: positive("reference viewport width", input.viewport.width),
      height: positive("reference viewport height", input.viewport.height),
      devicePixelRatio: positive("reference viewport devicePixelRatio", input.viewport.devicePixelRatio),
    }),
    asset: validateReferenceAsset(input.asset),
  })
}

/**
Chooses the split that gives subject and reference the largest common scale.

`prefer` is used only for an exact tie. The plan centers both frames and never
assigns different scales to them.

@param input - Available size, intrinsic subject/reference sizes and nonnegative
gap in the same logical units.

@throws If a size is not positive or `gap` cannot fit either split.
*/
export function planStorybookComparison(input: Readonly<{
  width: number
  height: number
  subject: Readonly<{width: number; height: number}>
  reference: Readonly<{width: number; height: number}>
  gap?: number
  prefer?: StorybookComparisonOrientation
}>): StorybookComparisonPlan {
  const width = positive("comparison width", input.width)
  const height = positive("comparison height", input.height)
  const subjectWidth = positive("subject width", input.subject.width)
  const subjectHeight = positive("subject height", input.subject.height)
  const referenceWidth = positive("reference width", input.reference.width)
  const referenceHeight = positive("reference height", input.reference.height)
  const gap = input.gap ?? 8
  if (!Number.isFinite(gap) || gap < 0 || gap >= Math.max(width, height)) {
    throw new Error(`Storybook comparison gap must fit the viewport: ${gap}`)
  }

  const horizontalScale = Math.min(
    Math.max(0, width - gap) / (subjectWidth + referenceWidth),
    height / Math.max(subjectHeight, referenceHeight),
  )
  const verticalScale = Math.min(
    width / Math.max(subjectWidth, referenceWidth),
    Math.max(0, height - gap) / (subjectHeight + referenceHeight),
  )
  const orientation = horizontalScale === verticalScale
    ? input.prefer ?? "horizontal"
    : horizontalScale > verticalScale ? "horizontal" : "vertical"
  const scale = orientation === "horizontal" ? horizontalScale : verticalScale

  if (orientation === "horizontal") {
    const subject = rect(subjectWidth * scale, subjectHeight * scale)
    const reference = rect(referenceWidth * scale, referenceHeight * scale)
    const totalWidth = subject.w + gap + reference.w
    const startX = (width - totalWidth) / 2
    return Object.freeze({
      orientation,
      scale,
      subject: Object.freeze({...subject, x: startX, y: (height - subject.h) / 2}),
      reference: Object.freeze({...reference, x: startX + subject.w + gap, y: (height - reference.h) / 2}),
    })
  }

  const subject = rect(subjectWidth * scale, subjectHeight * scale)
  const reference = rect(referenceWidth * scale, referenceHeight * scale)
  const totalHeight = subject.h + gap + reference.h
  const startY = (height - totalHeight) / 2
  return Object.freeze({
    orientation,
    scale,
    subject: Object.freeze({...subject, x: (width - subject.w) / 2, y: startY}),
    reference: Object.freeze({...reference, x: (width - reference.w) / 2, y: startY + subject.h + gap}),
  })
}

function validateReferenceAsset(asset: StorybookReferenceAsset): StorybookReferenceAsset {
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

function validateReferenceText(kind: string, value: string): void {
  if (value.trim().length === 0) throw new Error(`Storybook reference ${kind} must not be empty`)
}

function isCompatibility(value: string): value is StorybookReferenceCompatibility {
  return value === "compatible" || value === "changed" || value === "unverified"
}

function isAcceptance(value: string): value is StorybookReferenceAcceptance {
  return value === "candidate" || value === "accepted" || value === "superseded"
}

function positive(kind: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Storybook ${kind} must be positive: ${value}`)
  return value
}

function rect(w: number, h: number): StorybookComparisonRect {
  return Object.freeze({x: 0, y: 0, w, h})
}
