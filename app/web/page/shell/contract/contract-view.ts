import type {TypeDocProps} from "@zavx0z/immersive-typedoc"
import type {StorybookContractDocument} from "./documents"

/** Передаёт владельцу вкладки навигатор текущего направления; null отзывает его при unmount. */
export type StorybookContractNavigationReady = (
  direction: StorybookContractDocument["direction"],
  navigation: Parameters<NonNullable<TypeDocProps["onReady"]>>[0],
) => void

/** Передаёт выбор направления из URL и Inspector в существующий Display. */
export type StorybookContractSelection = Readonly<{
  initial: StorybookContractDocument["direction"]
  subscribe(listener: (direction: StorybookContractDocument["direction"]) => void): () => void
}>
