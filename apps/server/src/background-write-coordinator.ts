import { performance } from "node:perf_hooks";

export type BackgroundWriteCoordinatorRecord = {
  name: string;
  priority: number;
  durationMs: number;
};

export type BackgroundWriteCoordinatorOptions = {
  onRun?: (record: BackgroundWriteCoordinatorRecord) => void;
};

export class BackgroundWriteCoordinator {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: BackgroundWriteCoordinatorOptions = {}) {}

  run<T>(
    input: {
      name: string;
      priority: number;
    },
    work: () => T | Promise<T>
  ): Promise<T> {
    const execute = async () => {
      const startedAt = performance.now();
      try {
        return await work();
      } finally {
        this.options.onRun?.({
          name: input.name,
          priority: input.priority,
          durationMs: performance.now() - startedAt
        });
      }
    };

    const result = this.chain.then(execute, execute);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
