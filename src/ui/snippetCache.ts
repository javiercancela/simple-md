// One version per path; the owning DocColumn is remounted for each library session.
export class SnippetCache {
  private readonly entries = new Map<string, { mtimeMs: number; text: string }>();

  constructor(private readonly capacity = 256) {}

  get(path: string, mtimeMs: number): string | undefined {
    const entry = this.entries.get(path);
    if (!entry || entry.mtimeMs !== mtimeMs) return undefined;
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.text;
  }

  set(path: string, mtimeMs: number, text: string): void {
    this.entries.delete(path);
    this.entries.set(path, { mtimeMs, text });
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
