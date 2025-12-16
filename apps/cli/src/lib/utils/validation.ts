import type { OpencodeClient } from "@opencode-ai/sdk";
import {
  InvalidProviderError,
  InvalidModelError,
  ProviderNotConnectedError,
} from "../errors";

export const validateProviderAndModel = async (
  client: OpencodeClient,
  providerId: string,
  modelId: string
): Promise<void> => {
  try {
    const response = await client.provider.list();
    // If we couldn't fetch providers, skip validation (fail open)
    if (!response.data) {
      return;
    }

    const { all, connected } = response.data;

    // Check if provider exists
    const provider = all.find((p) => p.id === providerId);
    if (!provider) {
      throw new InvalidProviderError({
        providerId,
        availableProviders: all.map((p) => p.id),
      });
    }

    // Check if provider is connected (has valid auth)
    if (!connected.includes(providerId)) {
      throw new ProviderNotConnectedError({
        providerId,
        connectedProviders: connected,
      });
    }

    // Check if model exists for this provider
    const modelIds = Object.keys(provider.models);
    if (!modelIds.includes(modelId)) {
      throw new InvalidModelError({
        providerId,
        modelId,
        availableModels: modelIds,
      });
    }
  } catch (error) {
    // If fetching providers fails, skip validation
    return;
  }
};