// src/observability/integrations/base.ts
var _Integration = class _Integration {
  constructor() {
    this.originals = /* @__PURE__ */ new Map();
  }
  patchMethod(obj, key, build) {
    const orig = obj[key];
    if (typeof orig !== "function" || orig[_Integration.PATCHED])
      return;
    const wrapped = build(orig);
    wrapped[_Integration.PATCHED] = true;
    if (!this.originals.has(obj))
      this.originals.set(obj, /* @__PURE__ */ new Map());
    this.originals.get(obj).set(key, orig);
    obj[key] = wrapped;
  }
  teardown() {
    for (const [obj, map] of this.originals.entries()) {
      for (const [k, fn] of map) {
        obj[k] = fn;
      }
    }
    this.originals = /* @__PURE__ */ new Map();
  }
};
_Integration.PATCHED = Symbol("zePatched");
var Integration = _Integration;

export {
  Integration
};
