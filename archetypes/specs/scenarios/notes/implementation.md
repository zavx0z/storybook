# Ответственности src

- `discover.ts` находит владельца и собирает конфигурацию запуска.
- `imports.ts` разбирает и разрешает статические runtime imports.
- `preloads.ts` читает параметры подготовки среды из конфигурации пакета.
- `jsx-runtime.ts` определяет JSX transport из exports владельца preload.
- `trace.ts` запускает процесс, принимает записи и возвращает результат.
- `trace-preload.ts` подключает части сборщика в дочернем Bun.
- `instrument.ts` добавляет контекст в callback bodies через TypeScript AST.
- `context.ts` хранит варианты групп и асинхронный контекст тестов.
- `observe.ts` записывает вызовы, аргументы и порядок завершения.
- `serialize.ts` переносит значения без вызова getters.
- `call-location.ts` находит внешний frame вызова.
- `pending.ts` ожидает завершения отправок до итогового IPC report.
