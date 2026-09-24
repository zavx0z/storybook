/**
Разрешает MCP-адрес только до границы зарегистрированного пакета.
Внутренние директории и параметры не являются адресами этого этапа протокола.

@packageDocumentation
*/
import type {ResolveMcpAddressInput} from "./contract/input"
import type {ResolveMcpAddressOutput} from "./contract/output"

export type {ResolveMcpAddressInput, ResolveMcpAddressOutput}

/**
Проверяет синтаксис и точное присутствие адреса в переданных пакетных узлах.
Не сокращает внутренний путь до родителя и не превращает точки в слеши.

@param input - Адрес и пакетная проекция единственного каталога.
@returns Тот же адрес после проверки.
@throws TypeError при параметрах, fragment, пустых или относительных сегментах.
@throws Error, если адрес не принадлежит зарегистрированному пакету.
*/
export function resolveMcpAddress({address, packages}: ResolveMcpAddressInput): ResolveMcpAddressOutput {
  if (address.length === 0 || address.length > 512 || /[?#\\\u0000-\u0020\u007f]/u.test(address)
    || address.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError("MCP принимает только адрес пакета через /, без параметров и fragment")
  }
  if (!packages.includes(address)) throw new Error(`Адрес не принадлежит зарегистрированному пакету: ${address}`)
  return address
}
