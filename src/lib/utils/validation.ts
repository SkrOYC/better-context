import type { OpencodeClient } from "@opencode-ai/sdk";
import {
  InvalidProviderError,
  InvalidModelError,
  ProviderNotConnectedError,
  NonRetryableError,
} from "../errors";

export const validateProviderAndModel = async (
  client: OpencodeClient,
  providerId: string,
  modelId: string
): Promise<void> => {
  let response;
  try {
    response = await client.provider.list();
  } catch (error) {
    // If fetching providers fails, skip validation
    return;
  }

  // If we couldn't fetch providers, skip validation (fail open)
  if (!response.data) {
    return;
  }

  const { all, connected } = response.data;

  // Check if provider exists
  const provider = all.find((p) => p.id === providerId);
  if (!provider) {
    throw new InvalidProviderError(providerId, all.map((p) => p.id));
  }

  // Check if provider is connected (has valid auth)
  if (!connected.includes(providerId)) {
    throw new ProviderNotConnectedError(providerId, connected);
  }

  // Check if model exists for this provider
  const modelIds = Object.keys(provider.models);
  if (!modelIds.includes(modelId)) {
    throw new InvalidModelError(providerId, modelId, modelIds);
  }
};