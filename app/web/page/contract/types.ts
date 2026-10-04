import type WebProtocol from "@zavx0z/storybook-app-web-protocol"
import type {Zavx0zStorybookAppWebPageTarget} from "@zavx0z/storybook-app-web-page-target"

export type StorybookSharedHost = ReturnType<typeof WebProtocol.validateSharedHost>

export type ExternalStorybookPreparedPageTarget = ReturnType<Zavx0zStorybookAppWebPageTarget.Output["read"]>

export type ExternalStorybookPagePrepareInput = Parameters<Zavx0zStorybookAppWebPageTarget.Output["prepare"]>[1]
