import {startStorybookPackageServer} from "@zavx0z/storybook/server"
import {createStorybookDocumentationApp} from "./manifest.ts"
import {storybookDocumentationStaticFiles} from "./static-files.ts"

startStorybookPackageServer({
  app: createStorybookDocumentationApp(),
  staticFiles: storybookDocumentationStaticFiles(),
})
