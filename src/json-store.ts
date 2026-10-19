import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore<T> {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly initial: T,
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return structuredClone(this.initial);
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    await this.serial(async () => {
      await this.writeDirect(value);
    });
  }

  async update<R>(fn: (current: T) => Promise<[T, R]> | [T, R]): Promise<R> {
    return this.serial(async () => {
      const current = await this.read();
      const [next, result] = await fn(current);
      await this.writeDirect(next);
      return result;
    });
  }

  private async writeDirect(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, this.filePath);
  }

  private async serial<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
