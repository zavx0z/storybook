/** Временная рабочая область одного запуска; соседние каталоги ей не принадлежат. */
export type BuildWorkerWorkspace = Readonly<{
  workerId: string
  directory: string
}>
