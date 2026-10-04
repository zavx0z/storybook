/**
Передаёт страницу, маршруты и готовую общую оболочку между сервером и браузером.
Чтение и проверка протокола не запускают Node-сборку Web.

@packageDocumentation
*/
import {
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  EXTERNAL_STORYBOOK_RESOURCE_PREFIX,
  createExternalStorybookClientSnapshot,
  encodeExternalStorybookPackagePath,
  decodeExternalStorybookPackagePath,
  externalStorybookNodeResourceUrl,
} from "./src/client"
import {STORYBOOK_FONT_FACES} from "./src/font-faces"
import {externalStorybookPageTitle} from "./src/page-title"
import {
  readStorybookSharedHost,
  validateStorybookSharedHost,
  importStorybookSharedHost,
  synchronizeStorybookHostStyles,
} from "./src/shared-host"
import type {Zavx0zStorybookAppWebProtocol} from "./contract"

export type {Zavx0zStorybookAppWebProtocol} from "./contract"

/** Одна браузерно-безопасная таблица фактических операций протокола Web. */
const protocol: Zavx0zStorybookAppWebProtocol.Output = Object.freeze({
  clientProtocol: EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  resourcePrefix: EXTERNAL_STORYBOOK_RESOURCE_PREFIX,
  clientSnapshot: createExternalStorybookClientSnapshot,
  encodePackagePath: encodeExternalStorybookPackagePath,
  decodePackagePath: decodeExternalStorybookPackagePath,
  nodeResourceUrl: externalStorybookNodeResourceUrl,
  fontFaces: STORYBOOK_FONT_FACES,
  pageTitle: externalStorybookPageTitle,
  readSharedHost: readStorybookSharedHost,
  validateSharedHost: validateStorybookSharedHost,
  importSharedHost: importStorybookSharedHost,
  synchronizeStyles: synchronizeStorybookHostStyles,
})

export default protocol
