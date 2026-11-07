export class ExecutionController {
  private controller: AbortController | null = null;
  private generation = 0;

  begin(): { signal: AbortSignal; taskGeneration: number } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return { signal: this.controller.signal, taskGeneration: this.generation };
  }

  halt(): void {
    this.controller?.abort();
    this.controller = null;
  }

  isCurrent(taskGeneration: number): boolean {
    return taskGeneration === this.generation;
  }

  get signal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }
}
