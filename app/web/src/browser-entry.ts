import bootstrapStorybookPage from "./bootstrap"

/** Единый загрузчик главной страницы и страниц пакетов. */
if (typeof document !== "undefined") {
  void bootstrapStorybookPage(document).catch(error => {
    document.documentElement.dataset.externalStorybook = "error"
    document.documentElement.dataset.externalStorybookPhase = "error"
    document.documentElement.dataset.externalStorybookError = error instanceof Error ? error.message : String(error)
    console.error(error)
  })
}
