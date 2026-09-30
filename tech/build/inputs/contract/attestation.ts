import type {BuildInputFingerprint} from "./fingerprint"

/**
Сессия attestation сверяет входы на границах проверки и сборки.

`complete` возвращает evidence при совпадении байтов, состава и stat identity
входных файлов до и после операции. Любая неопределённость
завершает проверку ошибкой вместо публикации недостоверного cache key.

@property before - Снимок входов перед операцией.
*/
export type BuildInputAttestation = Readonly<{
  before: BuildInputFingerprint
  /**
  Сверяет inputs и расширяет evidence exact файлами compiler closure внутри guard.

  Выполняется однократно; после успеха или ошибки session завершена. Файл closure,
  впервые замеченный после начала операции с новым ctime, отклоняется как race.
  */
  complete(additionalFilePaths?: readonly string[]): Promise<BuildInputFingerprint>
  /** Идемпотентно прекращает session; последующий complete отклоняется. */
  dispose(): void
}>
