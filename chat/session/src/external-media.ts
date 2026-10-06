/** Получает внешнее изображение через ограниченный серверный IO; DNS закреплён на проверенном адресе. */
import {lookup} from "node:dns/promises"
import {isIP} from "node:net"
import {request as httpsRequest} from "node:https"
import {request as httpRequest} from "node:http"

const MAX_BYTES = 16 * 1024 * 1024
/** Служебные, loopback, private и multicast адреса не становятся media proxy targets. */
export function isPublicMediaAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number]
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || b === 2)) &&
      !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0)
  }
  // Только глобальный unicast 2000::/3; IPv4-mapped и local IPv6 сюда не входят.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/iu.test(address) && !/^2001:(?:0*:|0?db8:|0?2:)/iu.test(address) && !/^2002:/iu.test(address)
}

type ExternalImageAddress = Readonly<{address: string, family: number}>
type ExternalImageResponse = Readonly<{location: string}> | Readonly<{bytes: Uint8Array, mimeType: string}>
/** Test seam сохраняет тот же public-address gate и bounded retry policy. HTTP callers его не задают. */
export type ExternalImageIO = Readonly<{
  resolve(hostname: string): Promise<readonly ExternalImageAddress[]>
  request(url: URL, address: ExternalImageAddress, signal: AbortSignal): Promise<ExternalImageResponse>
}>
const RETRYABLE_NETWORK_ERRORS = new Set(["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"])
const networkCode = (error: unknown): string | undefined => error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // IO может отменить signal синхронно при создании Promise; его rejection всё равно наблюдаем.
    void promise.catch(() => {})
    signal.throwIfAborted()
  }
  let release = () => {}
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      const aborted = () => reject(signal.reason)
      signal.addEventListener("abort", aborted, {once: true})
      release = () => signal.removeEventListener("abort", aborted)
      if (signal.aborted) aborted()
    })])
  } finally {release()}
}

async function requestPinnedImage(url: URL, address: ExternalImageAddress, signal: AbortSignal): Promise<ExternalImageResponse> {
  return await new Promise<ExternalImageResponse>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal,
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: {accept: "image/*", "user-agent": "Storybook-Media/1"},
    }, response => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy()
        resolve({location: response.headers.location})
        return
      }
      const mimeType = String(response.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase()
      if (status !== 200 || !mimeType.startsWith("image/")) {
        response.destroy()
        reject(new Error(status !== 200 ? `Изображение недоступно (HTTP ${status})` : "Адрес не содержит изображение"))
        return
      }
      if (Number(response.headers["content-length"]) > MAX_BYTES) {
        response.destroy()
        reject(new Error("Внешнее изображение ограничено 16 МиБ"))
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      response.on("data", (chunk: Buffer) => {
        length += chunk.byteLength
        if (length > MAX_BYTES) {
          response.destroy(new Error("Внешнее изображение ограничено 16 МиБ"))
        } else chunks.push(chunk)
      })
      response.once("error", reject)
      response.once("end", () => resolve({bytes: Buffer.concat(chunks, length), mimeType}))
    })
    request.once("error", reject)
    request.end()
  })
}

const nativeIO: ExternalImageIO = {
  resolve: hostname => lookup(hostname, {all: true}),
  request: requestPinnedImage,
}

export async function fetchExternalImage(source: string, signal?: AbortSignal, io: ExternalImageIO = nativeIO): Promise<Readonly<{bytes: Uint8Array, mimeType: string, uri: string}>> {
  const timeout = AbortSignal.timeout(20_000)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    let url = new URL(source)
    for (let redirect = 0; redirect <= 4; redirect++) {
      abort.throwIfAborted()
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096 || url.port && !["80", "443"].includes(url.port)) {
        throw new Error("Недопустимый адрес внешнего изображения")
      }
      const hostname = url.hostname.replace(/^\[|\]$/gu, "")
      let addresses: readonly ExternalImageAddress[]
      try {
        addresses = isIP(hostname) ? [{address: hostname, family: isIP(hostname)}] : await abortable(io.resolve(hostname), abort)
      } catch (error) {
        if (abort.aborted) throw error
        throw new Error("Не удалось найти сервер изображения. Проверьте адрес и повторите.", {cause: error})
      }
      abort.throwIfAborted()
      if (!addresses.length || addresses.some(item => !isPublicMediaAddress(item.address) || isIP(item.address) !== item.family)) {
        throw new Error("Внешнее изображение не может обращаться к локальной или служебной сети")
      }
      // IPv4 работает и на hosts без IPv6-маршрута. Каждый fallback остаётся pinned к проверенному IP.
      const unique = [...new Map(addresses.map(address => [address.address, address])).values()]
      const candidates = unique.sort((left, right) => left.family - right.family).slice(0, 4)
      const failures: unknown[] = []
      let result: ExternalImageResponse | undefined
      for (const address of candidates) {
        abort.throwIfAborted()
        const attemptTimeout = AbortSignal.timeout(5_000)
        const attemptSignal = AbortSignal.any([abort, attemptTimeout])
        try {
          result = await abortable(io.request(url, address, attemptSignal), attemptSignal)
          break
        } catch (error) {
          if (abort.aborted) throw error
          if (!attemptTimeout.aborted && !RETRYABLE_NETWORK_ERRORS.has(networkCode(error) ?? "")) {
            if (networkCode(error)) throw new Error("Не удалось безопасно загрузить изображение. Проверьте адрес и повторите.", {cause: error})
            throw error
          }
          failures.push(error)
        }
      }
      if (!result) throw new Error("Не удалось подключиться к серверу изображения. Проверьте соединение и повторите.", {
        cause: new AggregateError(failures, "All verified public image addresses failed"),
      })
      if ("location" in result) {
        url = new URL(result.location, url)
        continue
      }
      return {...result, uri: url.href}
    }
    throw new Error("Слишком много перенаправлений изображения")
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted()
    if (timeout.aborted) throw new Error("Загрузка изображения заняла слишком много времени. Повторите.", {cause: error})
    throw error
  }
}
