import type { Event, ToolState, ToolStateCompleted, ToolStateError } from '@opencode-ai/sdk';
import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import type { ToolPartUpdatedEvent, ToolPart } from '../../types/events.ts';
import { isToolEvent, getToolOutput, getToolError, isToolStateCompleted, isToolStateError } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';

export interface ToolEventHandlerOptions {
  logLevel?: 'info' | 'debug' | 'tool';
  includeInputs?: boolean;
  redactSensitive?: boolean;
  outputStream?: NodeJS.WritableStream;
  enableVisibility?: boolean;
}

export class ToolEventHandler implements EventHandler<ToolPartUpdatedEvent> {
  private options: Required<ToolEventHandlerOptions>;

  constructor(options: ToolEventHandlerOptions = {}) {
    this.options = {
      logLevel: options.logLevel ?? 'tool',
      includeInputs: options.includeInputs ?? true,
      redactSensitive: options.redactSensitive ?? true,
      outputStream: options.outputStream ?? process.stdout,
      enableVisibility: options.enableVisibility ?? true,
    };
  }

  canHandle(event: SdkEvent): event is ToolPartUpdatedEvent {
    return isToolEvent(event);
  }

  async handle(event: ToolPartUpdatedEvent): Promise<void> {
    try {
      const toolPart = event.properties.part as ToolPart;

       // Log tool state changes for debugging

       // Output visibility to user if enabled and tool is starting
        if (this.options.enableVisibility && toolPart.state.status === 'running') {
          this.writeToOutput(`🔧 Using tool: ${toolPart.tool}\n`);
        }

        // Handle tool completion and error states
        if (this.options.enableVisibility) {
          if (toolPart.state.status === 'completed') {
            const output = getToolOutput(toolPart);
            this.writeToOutput(`✅ Tool completed: ${toolPart.tool}\n`);
            if (output && output.trim()) {
              this.writeToOutput(`${output}\n`);
            }
          } else if (toolPart.state.status === 'error') {
            const error = getToolError(toolPart);
            this.writeToOutput(`❌ Tool error: ${toolPart.tool} - ${error}\n`);
          }
        }

       // Define properly typed metadata object
       const metadata: {
         callID: string;
         sessionID: string;
         messageID: string;
         tool: string;
         status: string;
         input?: { [key: string]: unknown };
         output?: string;
         error?: string;
       } = {
         callID: toolPart.callID,
         sessionID: toolPart.sessionID,
         messageID: toolPart.messageID,
         tool: toolPart.tool,
         status: toolPart.state.status,
       };

       // Include input parameters if enabled
       if (this.options.includeInputs && toolPart.state.input) {
         let input = toolPart.state.input;

         // Redact sensitive information if enabled
         if (this.options.redactSensitive) {
           input = this.redactSensitiveData(input);
         }

         metadata.input = input;
       }

       // Include output for completed tools using discriminated union type guard
       if (isToolStateCompleted(toolPart.state)) {
         metadata.output = toolPart.state.output;
       }

       // Include error for failed tools using discriminated union type guard
       if (isToolStateError(toolPart.state)) {
         metadata.error = toolPart.state.error;
       }

       const message = `Tool ${toolPart.state.status}: ${toolPart.tool}`;

        // Log based on configured level
        switch (this.options.logLevel) {
          case 'debug':
            await logger.debug(`${message} ${JSON.stringify(metadata)}`);
            break;
          case 'info':
            await logger.info(`${message} ${JSON.stringify(metadata)}`);
            break;
          case 'tool':
          default:
            await logger.info(`[TOOL] ${message}\n${JSON.stringify(metadata, null, 2)}`);
            break;
        }

    } catch (error) {
      await logger.error(`Error handling tool event: ${error}`);
    }
  }

  private redactSensitiveData(input: { [key: string]: unknown }): { [key: string]: unknown } {
    const redacted = { ...input };

    // Redact common sensitive patterns
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];

    for (const [key, value] of Object.entries(redacted)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 100) {
        // Truncate very long strings
        redacted[key] = value.substring(0, 100) + '...[TRUNCATED]';
      }
    }

    return redacted;
  }

  private writeToOutput(text: string): void {
    if (!text) return;

    try {
      this.options.outputStream.write(text);
    } catch (error) {
      logger.error(`Error writing to output stream: ${error}`);
      // Fallback to console if output stream fails
      console.log(text);
    }
  }
}