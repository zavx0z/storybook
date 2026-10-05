/**
Явное соответствие прежнего и текущего адреса одной беседы при физическом
переносе владельца. Новый адрес и cwd проверяются через Input.resolve.
*/
export type Relocation = Readonly<{
  /** Без значения переносится default-беседа; UUID выбирает ровно одного существующего исполнителя. */
  executorId?: string
  from: Readonly<{address: string, cwd: string}>
  to: Readonly<{address: string, cwd: string}>
}>
