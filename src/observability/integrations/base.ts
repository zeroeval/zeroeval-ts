export abstract class Integration {
  static readonly PATCHED = Symbol('zePatched');

  protected originals = new Map<object, Map<string, unknown>>();

  protected patchMethod<T extends object, K extends keyof T>(
    obj: T,
    key: K,
    build: (orig: T[K]) => T[K]
  ): void {
    const orig = obj[key];
    if (typeof orig !== 'function' || (orig as any)[Integration.PATCHED]) return;

    const wrapped = build(orig);
    (wrapped as any)[Integration.PATCHED] = true;

    // store
    if (!this.originals.has(obj)) this.originals.set(obj, new Map());
    this.originals.get(obj)!.set(key as string, orig);

    // @ts-ignore – assigning function
    obj[key] = wrapped;
  }

  teardown(): void {
    for (const [obj, map] of this.originals.entries()) {
      for (const [k, fn] of map) {
        // @ts-ignore
        obj[k] = fn;
      }
    }
    this.originals = new Map();
  }

  abstract setup(): Promise<void> | void;
} 