/**
Реальный handle процесса, который использует startup lifecycle App.

@property pid - Identity порождённого процесса для проверки принадлежащей записи daemon.

@property exitCode - Текущее значение завершения, включая null пока процесс работает.

@property stderr - Поток пользовательской фабрики либо private файл диагностик.
Для независимого daemon файловый sink сохраняет запись после завершения parent.
Custom pipe пригоден для startup, но время жизни его writer зависит от parent;
фабрика отвечает за устойчивую диагностику после handoff.

@property unref - Штатно освобождает ожидание процесса родителем после owned ready.
*/
export type Daemon = Readonly<{
  pid: number
  exitCode: number | null
  exited: Promise<number>
  stderr: ReadableStream<Uint8Array> | Readonly<{path: string}>
  kill(signal?: number | NodeJS.Signals): void
  unref(): void
}>
