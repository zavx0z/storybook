import type {createViewPointControls} from "../src/controller"

/** Команды относятся к ViewPoint существующего Browser Root. Заморозка отключает жесты;
приближение и вписывание остаются явными командами пользователя. */
export interface ViewPointTabProps {
  readonly controls: ReturnType<typeof createViewPointControls>
}
