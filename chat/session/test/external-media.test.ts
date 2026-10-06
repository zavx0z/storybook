import {expect, test} from "bun:test"
import {fetchExternalImage, isPublicMediaAddress} from "../src/external-media"

test("external image не становится proxy для private, loopback, mapped IPv6 и служебных сетей", async () => {
  for (const address of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.2.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    expect(isPublicMediaAddress(address)).toBe(false)
  }
  expect(isPublicMediaAddress("8.8.8.8")).toBe(true)
  expect(isPublicMediaAddress("2606:4700:4700::1111")).toBe(true)
  await expect(fetchExternalImage("http://127.0.0.1/image.png")).rejects.toThrow("локальной")
  await expect(fetchExternalImage("file:///tmp/image.png")).rejects.toThrow("адрес")
  await expect(fetchExternalImage("https://name:password@example.com/image.png")).rejects.toThrow("адрес")
  const abort = new AbortController()
  abort.abort()
  await expect(fetchExternalImage("https://example.com/image.png", abort.signal)).rejects.toHaveProperty("name", "AbortError")
})

test("IPv4-first и failover используют только проверенные pinned адреса, ошибка первого IPv4 не скрывает успешный второй", async () => {
  const attempts: string[] = []
  const result = await fetchExternalImage("https://example.com/logo.png", undefined, {
    async resolve() {return [
      {address: "2606:4700:4700::1111", family: 6},
      {address: "8.8.8.8", family: 4},
      {address: "1.1.1.1", family: 4},
    ]},
    async request(url, address, signal) {
      expect(url.hostname).toBe("example.com")
      expect(signal.aborted).toBe(false)
      attempts.push(address.address)
      if (address.address === "8.8.8.8") throw Object.assign(new Error("connect refused"), {code: "ECONNREFUSED"})
      return {bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png"}
    },
  })
  expect(attempts).toEqual(["8.8.8.8", "1.1.1.1"])
  expect(result).toMatchObject({mimeType: "image/png", uri: "https://example.com/logo.png"})
})

test("failover ограничен четырьмя IP, человеку не выдаются network codes, полные причины сохраняются", async () => {
  const failures: Error[] = []
  let thrown: Error | undefined
  try {
    await fetchExternalImage("https://example.com/logo.png", undefined, {
      async resolve() {return ["8.8.8.8", "1.1.1.1", "9.9.9.9", "8.8.4.4", "1.0.0.1"].map(address => ({address, family: 4}))},
      async request(_url, address) {
        const failure = Object.assign(new Error(`connect ECONNREFUSED ${address.address}`), {code: "ECONNREFUSED"})
        failures.push(failure)
        throw failure
      },
    })
  } catch (error) {thrown = error as Error}
  expect(failures).toHaveLength(4)
  expect(thrown?.message).toContain("Проверьте соединение")
  expect(thrown?.message).not.toContain("ECONNREFUSED")
  expect(thrown?.cause).toBeInstanceOf(AggregateError)
  expect((thrown?.cause as AggregateError).errors).toEqual(failures)
})

test("HTTP/security errors и user abort не запускают сетевой failover", async () => {
  let calls = 0
  const resolve = async () => [{address: "8.8.8.8", family: 4}, {address: "1.1.1.1", family: 4}]
  await expect(fetchExternalImage("https://example.com/logo.png", undefined, {resolve, async request() {
    calls++
    throw new Error("Изображение недоступно (HTTP 404)")
  }})).rejects.toThrow("HTTP 404")
  expect(calls).toBe(1)
  calls = 0
  await expect(fetchExternalImage("https://example.com/logo.png", undefined, {
    async resolve() {return [...await resolve(), {address: "127.0.0.1", family: 4}]},
    async request() {calls++; return {bytes: new Uint8Array([1]), mimeType: "image/png"}},
  })).rejects.toThrow("локальной")
  expect(calls).toBe(0)
  const abort = new AbortController()
  await expect(fetchExternalImage("https://example.com/logo.png", abort.signal, {resolve, async request() {
    calls++
    abort.abort()
    throw Object.assign(new Error("socket closed"), {code: "ECONNRESET"})
  }})).rejects.toHaveProperty("name", "AbortError")
  expect(calls).toBe(1)
})
