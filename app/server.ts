import {startStorybookHubServer} from "@zavx0z/storybook/server"
import {createStorybookDocumentationApp} from "./manifest.ts"
import {storybookDocumentationStaticFiles} from "./static-files.ts"

const server = startStorybookHubServer({
  app: createStorybookDocumentationApp(),
  hostname: Bun.env.STORYBOOK_HOST ?? "127.0.0.1",
  port: Number(Bun.env.STORYBOOK_PORT ?? 4016),
  staticFiles: storybookDocumentationStaticFiles(),
})

console.log(`[storybook documentation] ${server.url}`)
