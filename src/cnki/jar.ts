/** Minimal mutable cookie jar for a single origin. */
export type JarCookie = { name: string; value: string; expires?: number };

export class CookieJar {
  private map = new Map<string, JarCookie>();

  constructor(init: JarCookie[] = []) {
    for (const c of init) this.map.set(c.name, c);
  }

  set(name: string, value: string, expires?: number): void {
    this.map.set(name, { name, value, expires });
  }

  /** Ingest every Set-Cookie value from a response. */
  absorb(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair, ...attrs] = line.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let expires: number | undefined;
      for (const a of attrs) {
        const [k, v] = a.split("=").map((s) => s?.trim());
        if (k?.toLowerCase() === "max-age" && v) expires = Date.now() + Number(v) * 1000;
      }
      if (value === "" || value === "deleted") this.map.delete(name);
      else this.set(name, value, expires);
    }
  }

  header(): string {
    return [...this.map.values()].map((c) => `${c.name}=${c.value}`).join("; ");
  }

  toJSON(): JarCookie[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }
}
