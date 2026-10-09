import {randomBytes} from "node:crypto"
import state from "@zavx0z/storybook-app-server-state"
import type {StorybookPackageBootstrapIntent} from "./package-page-target"
import type {BrowserSessionGrant} from "../contract/server"

const STORYBOOK_BROWSER_SESSION_TTL_MS = 120_000
const STORYBOOK_BROWSER_SESSION_MAX_ENTRIES = 1_024
const {ExternalStorybookSecurityError} = state

export class StorybookBrowserSessionRegistry {
  readonly #sessions = new Map<string, BrowserSessionGrant>()
  readonly #active = new Map<string, BrowserSessionGrant>()
  readonly #ttlMs: number
  readonly #maxEntries: number
  readonly #now: () => number

  constructor(options: Readonly<{
    ttlMs?: number
    maxEntries?: number
    now?: () => number
  }> = {}) {
    this.#ttlMs = boundedRegistryNumber(options.ttlMs ?? STORYBOOK_BROWSER_SESSION_TTL_MS, 1, 3_600_000, "TTL")
    this.#maxEntries = boundedRegistryNumber(
      options.maxEntries ?? STORYBOOK_BROWSER_SESSION_MAX_ENTRIES,
      1,
      100_000,
      "entry limit",
    )
    this.#now = options.now ?? Date.now
  }

  issue(input: Readonly<{
    kind: BrowserSessionGrant["kind"]
    packageId: string | null
    revision: string | null
    viewId?: string | null
    packageGraphDigest?: string | null
    intent?: StorybookPackageBootstrapIntent
    preview?: boolean
    release?: () => void
  }>): Readonly<{token: string, grant: BrowserSessionGrant}> {
    this.#removeExpired()
    while (this.#sessions.size + this.#active.size >= this.#maxEntries) {
      const oldest = this.#sessions.keys().next().value ?? this.#active.keys().next().value
      if (oldest === undefined) break
      this.release(oldest)
    }
    const intent = input.intent ?? "reader"
    const preview = input.preview ?? false
    if (input.kind === "registry" && (input.packageId !== null || input.revision !== null ||
      intent !== "reader" || preview)) {
      throw new Error("Registry browser session cannot carry package identity")
    }
    if (input.kind === "package" && input.packageId === null) {
      throw new Error("Package browser session requires package identity")
    }
    if (preview !== (intent === "preview")) {
      throw new Error("Package browser session preview and bootstrap intent must agree")
    }
    const token = randomBytes(32).toString("base64url")
    const allowedTopics = input.kind === "registry"
      ? new Set<string>(["registry", "environment"])
      : new Set<string>([`package:${input.packageId}`, "catalog", "environment"])
    const grant = Object.freeze({
      kind: input.kind,
      packageId: input.packageId,
      revision: input.revision,
      viewId: input.viewId ?? null,
      packageGraphDigest: input.packageGraphDigest ?? null,
      intent,
      preview,
      allowedTopics,
      expiresAt: this.#now() + this.#ttlMs,
      release: once(input.release ?? (() => {})),
    })
    this.#sessions.set(token, grant)
    return Object.freeze({token, grant})
  }

  consume(token: string): BrowserSessionGrant {
    this.#removeExpired()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) this.#reject()
    const grant = this.#sessions.get(token)
    if (grant === undefined || grant.expiresAt <= this.#now()) this.#reject()
    this.#sessions.delete(token)
    const active = Object.freeze({...grant, expiresAt: Number.POSITIVE_INFINITY})
    this.#active.set(token, active)
    return active
  }

  authorize(token: string): BrowserSessionGrant {
    this.#removeExpired()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) this.#reject()
    const grant = this.#active.get(token) ?? this.#sessions.get(token)
    if (grant === undefined || grant.expiresAt <= this.#now()) this.#reject()
    return grant
  }

  release(token: string): void {
    const grant = this.#active.get(token) ?? this.#sessions.get(token)
    this.#active.delete(token)
    this.#sessions.delete(token)
    grant?.release()
  }

  dispose(): void {
    for (const grant of [...this.#sessions.values(), ...this.#active.values()]) grant.release()
    this.#sessions.clear()
    this.#active.clear()
  }

  #removeExpired(): void {
    const now = this.#now()
    for (const [token, grant] of this.#sessions) {
      if (grant.expiresAt <= now) this.release(token)
    }
  }

  #reject(): never {
    throw new ExternalStorybookSecurityError(
      "invalid-browser-session",
      401,
      "External Storybook browser session is missing, expired or invalid",
    )
  }
}

function boundedRegistryNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Storybook browser session ${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}


function once(operation: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    operation()
  }
}
