import bootstrapStorybookPage from "@web/bootstrap"

/** Холодный browser entry сохраняет прежние маркеры отказа в native Document. */
if (typeof document !== "undefined") {
  void bootstrapStorybookPage(document).catch(error => {
    document.documentElement.dataset.externalStorybook = "error"
    document.documentElement.dataset.externalStorybookError = error instanceof Error ? error.message : String(error)
    console.error(error)
  })
}
