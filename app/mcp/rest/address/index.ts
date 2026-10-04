/**
Проверяет адрес публичного владельца или категории в общем каталоге Storybook.
Адрес выбирается из структуры, без параметров интерфейса.

@packageDocumentation
*/
import type {StorybookAppMcpRestAddress} from "./contract"

export type {StorybookAppMcpRestAddress} from "./contract"

/**
Проверяет синтаксис и точное присутствие адреса в переданной структуре.
Не сокращает внутренний путь до родителя и не превращает точки в слеши.

@param input - Адрес и публичные пути единственного каталога.
@returns Тот же адрес после проверки.
@throws TypeError при параметрах, fragment, пустых или относительных сегментах.
@throws Error, если адрес отсутствует в публичной структуре.
*/
export default function resolveMcpAddress({address, paths}: StorybookAppMcpRestAddress.Input): StorybookAppMcpRestAddress.Output {
  if (address.length === 0 || address.length > 512 || /[?#\\\u0000-\u0020\u007f]/u.test(address)
    || address.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError("MCP принимает адрес из children через /, без параметров и fragment")
  }
  if (!paths.includes(address)) throw new Error(`Адрес отсутствует в публичной структуре: ${address}`)
  return address
}
