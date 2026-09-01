import {createHmac, randomBytes, timingSafeEqual} from "node:crypto"
import type {
  ChromeTargetSummary,
  StorybookInternalView,
  StorybookPublicView,
} from "./contract.ts"

const VIEW_ID_PREFIX = "storybook-view-v1_"

/** Recoverable projection of actual Storybook browser targets into opaque view identities. */
export class StorybookViewRegistry {
  readonly #secret: Uint8Array
  readonly #viewsById = new Map<string, StorybookInternalView>()
  readonly #viewIdByTarget = new Map<string, string>()

  constructor(secret: Uint8Array = randomBytes(32)) {
    if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
      throw new Error("Storybook view registry secret must contain at least 32 bytes")
    }
    this.#secret = new Uint8Array(secret)
  }

  synchronize(targets: readonly ChromeTargetSummary[], origin: string): readonly StorybookPublicView[] {
    const canonicalOrigin = loopbackOrigin(origin)
    const nextViews = new Map<string, StorybookInternalView>()
    const packageIds = new Set<string>()
    for (const target of targets) {
      if (target.type !== "page") continue
      let identity: ReturnType<typeof storybookTargetIdentity>
      try {
        identity = storybookTargetIdentity(target, canonicalOrigin)
      } catch {
        identity = null
      }
      if (identity === null) continue
      const viewId = this.#idForTarget(target.targetId)
      const previous = this.#viewsById.get(viewId)
      if (previous !== undefined && previous.targetId !== target.targetId) {
        throw new Error("Storybook opaque view identity collision")
      }
      if (packageIds.has(identity.packageId)) {
        throw new Error(`Duplicate Storybook logical package view: ${identity.packageId}`)
      }
      packageIds.add(identity.packageId)
      const view = Object.freeze({
        viewId,
        targetId: target.targetId,
        origin: canonicalOrigin,
        packageId: identity.packageId,
        route: identity.route,
        url: target.url,
        title: target.title,
      })
      nextViews.set(viewId, view)
    }
    for (const [viewId, view] of this.#viewsById) {
      if (view.origin !== canonicalOrigin) continue
      this.#viewsById.delete(viewId)
      this.#viewIdByTarget.delete(view.targetId)
    }
    for (const [viewId, view] of nextViews) {
      this.#viewsById.set(viewId, view)
      this.#viewIdByTarget.set(view.targetId, viewId)
    }
    return Object.freeze([...this.#viewsById.values()]
      .filter((view) => view.origin === canonicalOrigin)
      .map(publicView))
  }

  register(target: ChromeTargetSummary, origin: string): StorybookPublicView {
    this.synchronize([target, ...this.#otherTargets(target.targetId)], origin)
    const viewId = this.#viewIdByTarget.get(target.targetId)
    if (viewId === undefined) throw new Error(`Chrome target is not an exact Storybook package view: ${target.url}`)
    return publicView(this.#viewsById.get(viewId)!)
  }

  internal(viewId: string): StorybookInternalView {
    validateViewId(viewId)
    const view = this.#viewsById.get(viewId)
    if (view === undefined || !this.#matches(viewId, view.targetId)) {
      throw new Error(`Unknown Storybook view: ${viewId}`)
    }
    return view
  }

  public(viewId: string): StorybookPublicView {
    return publicView(this.internal(viewId))
  }

  exactPackage(packageId: string, origin: string): StorybookInternalView | null {
    const canonicalOrigin = loopbackOrigin(origin)
    const matches = [...this.#viewsById.values()].filter((view) =>
      view.origin === canonicalOrigin && view.packageId === packageId)
    if (matches.length > 1) throw new Error(`Duplicate Storybook logical package view: ${packageId}`)
    return matches[0] ?? null
  }

  forget(viewId: string): boolean {
    const view = this.#viewsById.get(viewId)
    if (view === undefined) return false
    this.#viewsById.delete(viewId)
    this.#viewIdByTarget.delete(view.targetId)
    return true
  }

  forgetTarget(targetId: string): boolean {
    const viewId = this.#viewIdByTarget.get(targetId)
    return viewId === undefined ? false : this.forget(viewId)
  }

  list(): readonly StorybookPublicView[] {
    return Object.freeze([...this.#viewsById.values()].map(publicView))
  }

  #idForTarget(targetId: string): string {
    const current = this.#viewIdByTarget.get(targetId)
    if (current !== undefined) return current
    const digest = createHmac("sha256", this.#secret)
      .update("external-storybook-view\0")
      .update(targetId)
      .digest("base64url")
    return `${VIEW_ID_PREFIX}${digest}`
  }

  #matches(viewId: string, targetId: string): boolean {
    const expected = this.#idForTarget(targetId)
    const left = Buffer.from(viewId)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
  }

  #otherTargets(excludedTargetId: string): ChromeTargetSummary[] {
    return [...this.#viewsById.values()].flatMap((view) => view.targetId === excludedTargetId
      ? []
      : [{targetId: view.targetId, type: "page", title: view.title, url: view.url}])
  }
}

function storybookTargetIdentity(
  target: ChromeTargetSummary,
  origin: string,
): Readonly<{packageId: string; route: string}> | null {
  let url: URL
  try {
    url = new URL(target.url)
  } catch {
    return null
  }
  if (url.origin !== origin || url.search.length > 0 || url.hash.length > 0) return null
  const segments = url.pathname.split("/")
  if (segments[0] !== "" || segments[1] !== "packages" || segments[2] === undefined) return null
  const packageId = canonicalDecode(segments[2])
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageId)) return null
  const encodedRoute = segments.slice(3)
  if (encodedRoute.at(-1) === "") encodedRoute.pop()
  if (encodedRoute.some((segment) => segment.length === 0)) return null
  const route = encodedRoute.map(canonicalDecode).join("/")
  return Object.freeze({packageId, route})
}

function canonicalDecode(value: string): string {
  const decoded = decodeURIComponent(value)
  if (encodeURIComponent(decoded) !== value || decoded === "." || decoded === ".." || decoded.includes("\\")) {
    throw new Error(`Non-canonical Storybook target path segment: ${value}`)
  }
  return decoded
}

function loopbackOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`Storybook browser origin must be loopback HTTP: ${value}`)
  }
  return url.origin
}

function publicView(view: StorybookInternalView): StorybookPublicView {
  return Object.freeze({
    viewId: view.viewId,
    packageId: view.packageId,
    route: view.route,
    title: view.title,
  })
}

function validateViewId(value: string): void {
  if (typeof value !== "string" || !/^storybook-view-v1_[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error(`Invalid Storybook view identity: ${String(value)}`)
  }
}
