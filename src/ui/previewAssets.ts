import { resolveRelativeLink } from "../core/links";
import type { AssetPayload } from "../shared/types";

// One revision per path. Owned by the editor pane for a single library session.
export class PreviewAssets {
  private readonly entries = new Map<string, { revision: string; url: string }>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private bytes = 0;
  private disposed = false;

  constructor(
    private readonly load: (path: string, revision?: string) => Promise<AssetPayload | null>,
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly concurrency = 4,
    private readonly capacity = 128,
  ) {}

  read(from: string, href: string): Promise<string | null> {
    const path = resolveRelativeLink(from, href);
    if (!path || this.disposed) return Promise.resolve(null);
    const pending = this.pending.get(path);
    if (pending) return pending;
    const request = new Promise<string | null>((resolve) => {
      const finish = (url: string | null) => {
        this.pending.delete(path);
        resolve(url);
      };
      this.queue.push(() => {
        if (this.disposed) {
          finish(null);
          return;
        }
        this.active++;
        const cached = this.entries.get(path);
        void this.load(path, cached?.revision)
          .then((result) => {
            if (this.disposed) return finish(null);
            const url = result?.url ?? (result?.revision === cached?.revision ? cached?.url : null);
            this.remove(path);
            if (result && url && url.length * 2 <= this.maxBytes) {
              this.entries.set(path, { revision: result.revision, url });
              this.bytes += url.length * 2;
              while (this.bytes > this.maxBytes || this.entries.size > this.capacity)
                this.remove(this.entries.keys().next().value!);
            }
            finish(url ?? null);
          })
          .catch(() => finish(null))
          .finally(() => {
            this.active--;
            this.drain();
          });
      });
    });
    this.pending.set(path, request);
    this.drain();
    return request;
  }

  dispose(): void {
    this.disposed = true;
    this.entries.clear();
    this.bytes = 0;
    // Cancel queued requests immediately, even if an in-flight disk read stalls.
    while (this.queue.length) this.queue.shift()!();
  }

  private remove(path: string): void {
    const entry = this.entries.get(path);
    if (entry) this.bytes -= entry.url.length * 2;
    this.entries.delete(path);
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) this.queue.shift()!();
  }
}
