declare module "global-shortcuts" {
  export class GlobalHotKeyManager {
    register(
      accelerator: string,
      callback: (id: string, state?: string) => void | Promise<void>
    ): Promise<string>;
    unregister(id: string): Promise<void>;
    dispose?(): Promise<void>;
  }
}
