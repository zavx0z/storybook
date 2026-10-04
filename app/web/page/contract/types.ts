import type WebProtocol from "@zavx0z/storybook-app-web-protocol"
import type {StorybookAppWebPageTarget} from "@zavx0z/storybook-app-web-page-target"

export type StorybookSharedHost = ReturnType<typeof WebProtocol.validateSharedHost>

export type ExternalStorybookPreparedPageTarget = ReturnType<StorybookAppWebPageTarget.Output["read"]>

export type ExternalStorybookPagePrepareInput = Parameters<StorybookAppWebPageTarget.Output["prepare"]>[1]
