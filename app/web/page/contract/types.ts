import type WebProtocol from "@app-web/protocol"
import type {WebPageTarget} from "@web/page-target"

export type StorybookSharedHost = ReturnType<typeof WebProtocol.validateSharedHost>

export type ExternalStorybookPreparedPageTarget = ReturnType<WebPageTarget.Output["read"]>

export type ExternalStorybookPagePrepareInput = Parameters<WebPageTarget.Output["prepare"]>[1]
