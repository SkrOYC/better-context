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

export class InvalidTechError extends Error {
  readonly _tag = "InvalidTechError";
  override readonly name = "InvalidTechError";
  constructor(
    readonly techName: string,
    readonly availableTechs: string[],
    readonly suggestedTechs: string[] = []
  ) {
    let message = `Technology "${techName}" not found.`;

    if (suggestedTechs.length > 0) {
      message += ` Did you mean: ${suggestedTechs.join(', ')}?`;
    } else {
      message += ` Available technologies: ${availableTechs.join(', ')}.`;
    }

    super(message);
  }
}

export class RetryableError extends Error {
  readonly _tag = "RetryableError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class NonRetryableError extends Error {
  readonly _tag = "NonRetryableError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class StartupValidationError extends Error {
  readonly _tag = "StartupValidationError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class ConfigurationChangeError extends Error {
  readonly _tag = "ConfigurationChangeError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export class ValidationCacheError extends Error {
  readonly _tag = "ValidationCacheError";
  constructor(override readonly message: string, override readonly cause?: unknown) {
    super(message);
  }
}