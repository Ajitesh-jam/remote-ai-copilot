declare module "node-global-key-listener" {
  export class GlobalKeyboardListener {
    constructor(config?: Record<string, unknown>);
    addListener(
      cb: (
        e: { name?: string; state: string; rawKey?: unknown },
        down: Record<string, boolean>
      ) => boolean | void
    ): void;
    removeListener(cb: (...args: unknown[]) => unknown): void;
    kill(): void;
  }
}
