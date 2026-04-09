import { vi } from 'vitest';

// Mock the integration utils to prevent dynamic imports of optional dependencies
vi.mock('./src/observability/integrations/utils', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('./src/observability/integrations/utils')
    >();

  return {
    ...actual,
    discoverIntegrations: vi.fn().mockResolvedValue({}),
  };
});

// Mock process.on to prevent event listener warnings
global.process.on = vi.fn() as any;

// Optionally expose gc for memory tests
if (!global.gc) {
  (global as any).gc = () => {
    // No-op in tests without --expose-gc
  };
}
