export const QWEN_PRIMARY_MODEL = "qwen3.8-max";
export const QWEN_PRIMARY_CONTEXT_WINDOW = 500000;

const modelContextWindows: Record<string, number> = {
  [QWEN_PRIMARY_MODEL]: QWEN_PRIMARY_CONTEXT_WINDOW,
};

const modelTokenDivisors: Record<string, number> = {
  [QWEN_PRIMARY_MODEL]: 2.2,
};

const defaultContextWindow = 131072;
const defaultTokenDivisor = 2.0;
export const MAX_PAYLOAD_SIZE = 50 * 1024 * 1024;

export function getModelContextWindow(modelId: string): number {
  return modelContextWindows[modelId] ?? defaultContextWindow;
}

export function getModelTokenDivisor(modelId: string): number {
  return modelTokenDivisors[modelId] ?? defaultTokenDivisor;
}

export function syncModelContextWindows(
  models: Array<{ id: string; context_window?: number }>,
): void {
  for (const m of models) {
    if (m.id === QWEN_PRIMARY_MODEL && m.context_window) {
      modelContextWindows[m.id] = m.context_window;
    }
  }
}
