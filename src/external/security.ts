import {createHash, timingSafeEqual} from "node:crypto"

export type ExternalStorybookRequestAuthority = Readonly<{
  origin: string
  controlToken: string
}>

export type ExternalStorybookSecurityErrorCode =
  | "invalid-host"
  | "invalid-origin"
  | "missing-origin"
  | "invalid-control-token"
  | "invalid-browser-session"

export class ExternalStorybookSecurityError extends Error {
  readonly code: ExternalStorybookSecurityErrorCode
  readonly status: 401 | 403 | 421

  constructor(code: ExternalStorybookSecurityErrorCode, status: 401 | 403 | 421, message: string) {
    super(message)
    this.name = "ExternalStorybookSecurityError"
    this.code = code
    this.status = status
  }
}

/** Produces the private header used only by trusted CLI/controller/MCP clients. */
export function externalStorybookControlAuthorization(controlToken: string): string {
  return `Bearer ${validateControlToken(controlToken)}`
}

/** Compares bearer capabilities without data-dependent string comparison. */
export function externalStorybookControlTokenMatches(
  authorization: string | null,
  controlToken: string,
): boolean {
  const expected = validateControlToken(controlToken)
  const candidate = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : ""
  const expectedDigest = createHash("sha256").update(expected).digest()
  const candidateDigest = createHash("sha256").update(candidate).digest()
  return timingSafeEqual(candidateDigest, expectedDigest) && candidate.length === expected.length
}

/** Rejects DNS-rebinding and alternate-host access before routing a request. */
export function assertExternalStorybookRequestHost(request: Request, expectedOrigin: string): void {
  const expected = exactLoopbackOrigin(expectedOrigin)
  const actual = new URL(request.url)
  const host = request.headers.get("host")
  if (actual.origin !== expected.origin || (host !== null && host !== expected.host)) {
    throw new ExternalStorybookSecurityError(
      "invalid-host",
      421,
      "External Storybook request host does not match the canonical server origin",
    )
  }
}

/** Enforces the canonical browser origin; trusted non-browser control calls may omit it. */
export function assertExternalStorybookRequestOrigin(
  request: Request,
  expectedOrigin: string,
  options: Readonly<{required?: boolean}> = {},
): void {
  const expected = exactLoopbackOrigin(expectedOrigin)
  const header = request.headers.get("origin")
  if (header === null) {
    if (options.required === true) {
      throw new ExternalStorybookSecurityError(
        "missing-origin",
        403,
        "External Storybook browser request has no Origin",
      )
    }
    return
  }
  let actual: URL
  try {
    actual = new URL(header)
  } catch {
    throw new ExternalStorybookSecurityError(
      "invalid-origin",
      403,
      "External Storybook request Origin is invalid",
    )
  }
  if (header !== actual.origin || actual.origin !== expected.origin) {
    throw new ExternalStorybookSecurityError(
      "invalid-origin",
      403,
      "External Storybook request Origin does not match the canonical server origin",
    )
  }
}

/** Applies the complete control-plane authority check without exposing its token. */
export function assertExternalStorybookControlRequest(
  request: Request,
  authority: ExternalStorybookRequestAuthority,
): void {
  assertExternalStorybookRequestHost(request, authority.origin)
  assertExternalStorybookRequestOrigin(request, authority.origin)
  if (!externalStorybookControlTokenMatches(
    request.headers.get("authorization"),
    authority.controlToken,
  )) {
    throw new ExternalStorybookSecurityError(
      "invalid-control-token",
      401,
      "External Storybook control authorization failed",
    )
  }
}

function exactLoopbackOrigin(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new TypeError(`External Storybook canonical origin is invalid: ${value}`)
  }
  return url
}

function validateControlToken(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new TypeError("External Storybook control token is invalid")
  }
  return value
}
