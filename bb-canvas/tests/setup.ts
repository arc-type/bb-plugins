// React Flow measures its container and nodes through ResizeObserver and reads
// the viewport transform through DOMMatrixReadOnly — jsdom has neither, and
// the canvas would throw on mount. Stubs are enough: nodes carry an explicit
// size, so nothing in a test depends on a real measurement.
if (typeof window !== "undefined") {
  const scope = globalThis as Record<string, unknown>;
  if (!scope.ResizeObserver) {
    scope.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!scope.DOMMatrixReadOnly) {
    scope.DOMMatrixReadOnly = class {
      m22: number;
      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([^)]+)\)/)?.[1];
        this.m22 = scale ? Number(scale) : 1;
      }
    };
  }
}
