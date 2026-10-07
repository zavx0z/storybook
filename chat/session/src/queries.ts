import type {Database} from "bun:sqlite"

/** Ограниченный кеш запросов одного индекса; глобальные настройки SQLite/Bun не меняются. */
const statements = new WeakMap<Database, Map<string, ReturnType<Database["query"]>>>()

export function query(db: Database, source: string): ReturnType<Database["query"]> {
  let cache = statements.get(db)
  if (!cache) {cache = new Map(); statements.set(db, cache)}
  const retained = cache.get(source)
  if (retained) {
    cache.delete(source)
    cache.set(source, retained)
    return retained
  }
  // У native query кеш только на 20 SQL; полный цикл записи истории больше него.
  // Удерживаем ограниченный набор prepared statements до закрытия этого соединения.
  const statement = db.query(source)
  cache.set(source, statement)
  if (cache.size > 128) cache.delete(cache.keys().next().value!)
  return statement
}
