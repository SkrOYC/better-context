export class GeneralError extends Error {
  readonly _tag = "GeneralError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class OcError extends Error {
  readonly _tag = "OcError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class ConfigError extends Error {
  readonly _tag = "ConfigError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class InvalidProviderError extends Error {
  readonly _tag = "InvalidProviderError";
  constructor(
    readonly providerId: string,
    readonly availableProviders: string[]
  ) {
    super(`Invalid provider: ${providerId}`);
  }
}

export class InvalidModelError extends Error {
  readonly _tag = "InvalidModelError";
  constructor(
    readonly providerId: string,
    readonly modelId: string,
    readonly availableModels: string[]
  ) {
    super(`Invalid model: ${modelId} for provider ${providerId}`);
  }
}

export class ProviderNotConnectedError extends Error {
  readonly _tag = "ProviderNotConnectedError";
  constructor(
    readonly providerId: string,
    readonly connectedProviders: string[]
  ) {
    super(`Provider not connected: ${providerId}`);
  }
}