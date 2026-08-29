import {describe, expect, test} from "bun:test"
import {
  ExternalStorybookSecurityError,
  assertExternalStorybookControlRequest,
  assertExternalStorybookRequestHost,
  assertExternalStorybookRequestOrigin,
  externalStorybookControlAuthorization,
  externalStorybookControlTokenMatches,
} from "./security.ts"

const origin = "http://127.0.0.1:43123"
const controlToken = "a".repeat(43)

describe("external Storybook control security", () => {
  test("accepts only the exact bearer capability", () => {
    const authorization = externalStorybookControlAuthorization(controlToken)
    expect(authorization).toBe(`Bearer ${controlToken}`)
    expect(externalStorybookControlTokenMatches(authorization, controlToken)).toBeTrue()
    expect(externalStorybookControlTokenMatches(null, controlToken)).toBeFalse()
    expect(externalStorybookControlTokenMatches("Basic value", controlToken)).toBeFalse()
    expect(externalStorybookControlTokenMatches(`Bearer ${"b".repeat(43)}`, controlToken)).toBeFalse()
    expect(externalStorybookControlTokenMatches(`Bearer ${controlToken}x`, controlToken)).toBeFalse()
  })

  test("rejects alternate hosts before control routing", () => {
    expect(() => assertExternalStorybookRequestHost(
      request("http://evil.test:43123/api/stop", {host: "evil.test:43123"}),
      origin,
    )).toThrow(ExternalStorybookSecurityError)
    expect(() => assertExternalStorybookRequestHost(
      request(`${origin}/api/stop`, {host: "localhost:43123"}),
      origin,
    )).toThrow("canonical server origin")
    expect(() => assertExternalStorybookRequestHost(request(`${origin}/api/stop`), origin)).not.toThrow()
  })

  test("requires exact browser origins while allowing token-authenticated server clients to omit it", () => {
    expect(() => assertExternalStorybookRequestOrigin(
      request(`${origin}/api/events`, {origin: "https://evil.test"}),
      origin,
      {required: true},
    )).toThrow("does not match")
    expect(() => assertExternalStorybookRequestOrigin(
      request(`${origin}/api/events`),
      origin,
      {required: true},
    )).toThrow("has no Origin")
    expect(() => assertExternalStorybookRequestOrigin(
      request(`${origin}/api/events`, {origin}),
      origin,
      {required: true},
    )).not.toThrow()
    expect(() => assertExternalStorybookRequestOrigin(request(`${origin}/api/status`), origin)).not.toThrow()
  })

  test("combines host, optional Origin and bearer checks without leaking the capability", () => {
    const valid = request(`${origin}/api/status`, {
      authorization: externalStorybookControlAuthorization(controlToken),
    })
    expect(() => assertExternalStorybookControlRequest(valid, {origin, controlToken})).not.toThrow()

    for (const candidate of [
      request(`${origin}/api/status`),
      request(`${origin}/api/status`, {authorization: "Bearer invalid"}),
      request(`${origin}/api/status`, {
        authorization: externalStorybookControlAuthorization(controlToken),
        origin: "https://evil.test",
      }),
    ]) {
      try {
        assertExternalStorybookControlRequest(candidate, {origin, controlToken})
        throw new Error("Expected control authorization to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(ExternalStorybookSecurityError)
        expect(String(error)).not.toContain(controlToken)
      }
    }
  })
})

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {headers})
}
