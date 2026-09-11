import {startExternalStorybookPage} from "./page-entry.ts"

/**
Читает подтверждённую сервером эпоху executable shared либо host module set.

Значение существует только в cold HTML bootstrap и связывает lifetime текущей
страницы с exact module identities: {@link startExternalStorybookPage} отклоняет
later payload другой эпохи до same-page application.

@param kind - `shared` для общего kernel или `host` для browser entry modules.

@returns SHA-256 epoch из trusted server HTML meta.

@throws {@link Error}, если meta отсутствует или не имеет формата SHA-256.
*/
function moduleEpoch(kind: "shared" | "host"): string {
  const value = document.querySelector<HTMLMetaElement>(
    `meta[name="external-storybook-${kind}-module-epoch"]`,
  )?.content
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Storybook bootstrap ${kind} module epoch is unavailable`)
  }
  return value
}

if (typeof document !== "undefined") {
  void Promise.resolve().then(() => startExternalStorybookPage({
    sharedModuleEpoch: moduleEpoch("shared"),
    hostModuleEpoch: moduleEpoch("host"),
  })).catch(error => {
    document.documentElement.dataset.externalStorybook = "error"
    document.documentElement.dataset.externalStorybookPhase = "error"
    document.documentElement.dataset.externalStorybookError = error instanceof Error ? error.message : String(error)
    console.error(error)
  })
}
