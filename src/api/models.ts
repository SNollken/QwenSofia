import { createHash } from "crypto";
import { Hono } from "hono";
import { fetchQwenModels } from "../services/qwen.js";
import { loadAccounts } from "../core/accounts.ts";
import { getAccountCooldownInfo } from "../core/account-manager.ts";
import { NotFoundError } from "../core/errors.js";
import { sendOpenAIError } from "./error-helpers.js";
import {
  QWEN_PRIMARY_MODEL,
  QWEN_PRIMARY_CONTEXT_WINDOW,
  syncModelContextWindows,
} from "../core/model-registry.ts";

type PublicQwenModel = Awaited<ReturnType<typeof fetchQwenModels>>[number];

const app = new Hono();
const FETCH_MODELS_TIMEOUT_MS = 5000;

function buildPublicModelCatalog<T extends { id: string }>(models: T[]): T[] {
  const model = models.find((entry) => entry.id === QWEN_PRIMARY_MODEL);
  return model ? [model] : [];
}

function getPreferredModelsAccountId(): string | undefined {
  try {
    const accounts = loadAccounts();
    const available = accounts.find(
      (account) => !getAccountCooldownInfo(account.id),
    );
    return (available || accounts[0])?.id;
  } catch {
    return undefined;
  }
}

async function fetchModelsWithFallback(
  accountId?: string,
): Promise<PublicQwenModel[]> {
  try {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Timeout fetching models after ${FETCH_MODELS_TIMEOUT_MS}ms`,
          ),
        );
      }, FETCH_MODELS_TIMEOUT_MS);
      timeoutId.unref?.();
    });

    try {
      return await Promise.race([
        fetchQwenModels(accountId),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    console.warn(
      "⚠️ [Models] Failed to fetch models from Qwen, using static fallback:",
      error,
    );
    const fallbackModel: PublicQwenModel = {
      id: QWEN_PRIMARY_MODEL,
      name: QWEN_PRIMARY_MODEL,
      object: "model",
      owned_by: "QwenSofia",
      created: 0,
      context_window: QWEN_PRIMARY_CONTEXT_WINDOW,
    };
    return [fallbackModel];
  }
}

app.get("/v1/models", async (c) => {
  try {
    const models = await fetchModelsWithFallback(getPreferredModelsAccountId());
    const allModels = buildPublicModelCatalog(models);
    const etag = `"${createHash("md5").update(JSON.stringify(allModels)).digest("hex")}"`;

    if (c.req.header("if-none-match") === etag) {
      return c.body(null, 304);
    }

    c.header("Cache-Control", "public, max-age=3600");
    c.header("ETag", etag);

    syncModelContextWindows(allModels);

    return c.json({
      object: "list",
      data: allModels,
    });
  } catch (error) {
    console.error("❌ [Models] Error fetching models:", error);
    return sendOpenAIError(c, error);
  }
});

app.get("/v1/models/:model", async (c) => {
  try {
    const modelId = c.req.param("model");
    const models = await fetchModelsWithFallback(getPreferredModelsAccountId());
    syncModelContextWindows(models);

    const publicModels = buildPublicModelCatalog(models);

    const model = publicModels.find((entry) => entry.id === modelId);

    if (!model) {
      return sendOpenAIError(c, new NotFoundError("Model not found"));
    }

    return c.json(model);
  } catch (error) {
    console.error("❌ [Models] Error fetching model:", error);
    return sendOpenAIError(c, error);
  }
});

export { app, fetchModelsWithFallback };
