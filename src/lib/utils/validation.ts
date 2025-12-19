import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import type { ConfigService } from "../../services/config";
import {
  InvalidProviderError,
  InvalidModelError,
  OcError,
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
    throw new OcError(`Provider "${providerId}" is not connected. Connected providers: ${connected.join(', ')}. Run "opencode auth" to configure provider credentials.`);
  }

  // Check if model exists for this provider
  const modelIds = Object.keys(provider.models);
  if (!modelIds.includes(modelId)) {
    throw new InvalidModelError(providerId, modelId, modelIds);
  }
};

export async function withTempOpenCodeClient<T>(
  config: ConfigService,
  action: (client: OpencodeClient) => Promise<T>,
  timeout: number = 10000
): Promise<T> {
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = config.getOpenCodeConfigDir();

  try {
    const { client, server } = await createOpencode({
      port: 0,
      timeout: timeout,
    });

    try {
      return await action(client);
    } finally {
      server.close();
    }
  } finally {
    if (originalConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENCODE_CONFIG_DIR;
    }
  }
}
