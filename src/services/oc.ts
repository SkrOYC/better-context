import {
	createOpencodeClient,
	OpencodeClient,
	type Event,
	type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import path from 'node:path';
import { OcError, InvalidTechError } from '../lib/errors.ts';
import { findSimilarStrings } from '../lib/utils/fuzzy-matcher.ts';
import { logger } from '../lib/utils/logger.ts';

export type { Event as OcEvent };

export class OcService {
	private configService: ConfigService;
	private openCodeInstance: { client: OpencodeClient; server: { close: () => void; url: string } };

	constructor(
		configService: ConfigService,
		openCodeInstance: { client: OpencodeClient; server: { close: () => void; url: string } }
	) {
		this.configService = configService;
		this.openCodeInstance = openCodeInstance;
	}

	async shutdown(): Promise<void> {
		try {
			await logger.info('OcService shutdown complete');
		} catch (error) {
			await logger.error(`Error during OcService shutdown: ${error}`);
			throw error;
		}
	}

	private async createDirectoryClient(tech: string): Promise<OpencodeClient> {
		const repoPath = path.join(this.configService.getReposDirectory(), tech);
		const clientWithDirectory = createOpencodeClient({
			baseUrl: this.openCodeInstance.server.url,
			directory: repoPath
		});

		await logger.info(`Created directory client for ${tech} with directory: ${repoPath}`);
		return clientWithDirectory;
	}

	async askQuestion(args: { question: string; tech: string }): Promise<void> {
		const { question, tech } = args;
		let sessionID: string | null = null;
		const operationId = `ask-${tech}-${Date.now()}`;

		await logger.info(`[${operationId}] Starting question about ${tech}: "${question}"`);
		logger.startTimer(`ask-${operationId}`);

		// Validate tech name first and provide suggestions if not found
		const allRepos = this.configService.getRepos();
		const availableTechs = allRepos.map((repo) => repo.name);
		if (!availableTechs.includes(tech)) {
			const suggestedTechs = findSimilarStrings(tech, availableTechs, 3);
			throw new InvalidTechError(tech, availableTechs, suggestedTechs);
		}

		await logger.info(`[${operationId}] Updating local repo for ${tech}`);
		logger.startTimer(`repo-update-${operationId}`);
		await this.configService.cloneOrUpdateOneRepoLocally(tech, { suppressLogs: true });
		await logger.endTimerWithMessage(`repo-update-${operationId}`, `Repo update completed for ${tech}`);

		try {
			// Create directory-specific client using global instance
			logger.startTimer(`client-create-${operationId}`);
			const clientWithDirectory = await this.createDirectoryClient(tech);
			await logger.endTimerWithMessage(`client-create-${operationId}`, `Directory client created for ${tech}`);

			// Create new session
			const repoPath = path.join(this.configService.getReposDirectory(), tech);
			await logger.info(`[${operationId}] Creating session for ${tech} with working directory: ${repoPath}`);
			logger.startTimer(`session-create-${operationId}`);

			const session = await clientWithDirectory.session.create({
				query: {
					directory: repoPath
				}
			});

			if (session.error) {
				const errorDetail = JSON.stringify(session.error, null, 2);
				await logger.error(`[${operationId}] Failed to start OpenCode session for ${tech}: ${errorDetail}`);
				throw new OcError(`FAILED TO START OPENCODE SESSION: ${errorDetail}`, session.error);
			}

			sessionID = session.data.id;
			await logger.endTimerWithMessage(`session-create-${operationId}`, `Session created for ${tech} with ID: ${sessionID}`);

			// Get the event stream
			await logger.info(`[${operationId}] Subscribing to event stream for session ${sessionID}`);
			logger.startTimer(`event-stream-${operationId}`);
			const eventsSubscription = await clientWithDirectory.event.subscribe({});
			await logger.endTimerWithMessage(`event-stream-${operationId}`, `Event stream subscribed for session ${sessionID}`);
			
			const writtenLengths = new Map<string, number>();

			// Send prompt, but don't await promise here. Process events concurrently.
			await logger.info(`[${operationId}] Sending prompt to session ${sessionID}`);
			logger.startTimer(`prompt-${operationId}`);
			const promptPromise = clientWithDirectory.session.prompt({
				path: { id: sessionID },
				body: {
					model: {
						providerID: this.configService.rawConfig().provider,
						modelID: this.configService.rawConfig().model
					},
					parts: [{ type: 'text', text: question }]
				}
			});

			const messageRoles = new Map<string, string>();

			// Process events directly
			for await (const event of eventsSubscription.stream) {
				const props = event.properties as any;

				// Track message roles from info events
				if (event.type === 'message.updated') {
					const info = props.info || props.message;
					if (info && info.id && info.role) {
						messageRoles.set(info.id, info.role);
					}
				}

				// Identify session ID from various possible locations in event properties
				const eventSessionID =
					props.sessionID ||
					props.session?.id ||
					props.part?.sessionID ||
					props.message?.sessionID ||
					props.info?.sessionID ||
					props.info?.id;

				// Filter events for our session if we can identify the session
				if (eventSessionID && eventSessionID !== sessionID) {
					continue;
				}

				// Handle session completion
				const status = props.status;
				const statusType = typeof status === 'object' ? status?.type : status;

				if (
					(event.type === 'session.status' && statusType === 'idle') ||
					event.type === 'session.idle'
				) {
					await logger.info(`Session ${sessionID} reached idle state`);
					break;
				}

				// Handle session errors
				if (event.type === 'session.error') {
					const errorProps = event.properties as { error?: { message?: string } };
					const errorMsg = `Session ${sessionID} errored: ${errorProps.error?.message || 'Unknown error'}`;
					await logger.error(errorMsg);
					throw new OcError(errorMsg, errorProps.error);
				}

				// Output text parts in real-time
				if (event.type === 'message.part.updated') {
					const part = props.part as any;
					if (part && part.type === 'text') {
						const partID = `${part.messageID}-${part.index ?? 0}`;

						// Check role - if unknown, we assume it might be assistant until proven otherwise,
						// but we also check if the text matches the user question.
						let role = messageRoles.get(part.messageID);

						// If we know it's the user, skip
						if (role === 'user') continue;

						// If text exactly matches question, it's likely the user prompt being echoed
						if (part.text === question) {
							messageRoles.set(part.messageID, 'user');
							continue;
						}

						// At this point it's likely assistant or unknown role
						if (props.delta) {
							await logger.write(props.delta);
							writtenLengths.set(partID, (part.text || '').length);
						} else {
							const fullText = part.text || '';
							const alreadyWritten = writtenLengths.get(partID) || 0;

							if (fullText.length > alreadyWritten) {
								const delta = fullText.slice(alreadyWritten);
								await logger.write(delta);
								writtenLengths.set(partID, fullText.length);
							}
						}
					}
				}
			}

			// Now, await prompt promise to catch any errors during its submission.
			await logger.endTimerWithMessage(`prompt-${operationId}`, `Prompt sent to session ${sessionID}`);
			const promptResponse = await promptPromise;
			if (promptResponse.error) {
				throw new OcError('Prompt failed', promptResponse.error);
			}

			// Ensure we end with a newline
			await logger.write('\n');
			await logger.endTimerWithMessage(`ask-${operationId}`, `Question answered successfully for ${tech}`);
		} catch (error) {
			await logger.error(
				`[${operationId}] Error in askQuestion for ${tech}: ${error instanceof Error ? error.message : String(error)}`
			);

			// Try to abort the session if it exists
			if (sessionID) {
				try {
					const clientWithDirectory = await this.createDirectoryClient(tech);
					await clientWithDirectory.session.abort({ path: { id: sessionID } });
					await logger.info(`[${operationId}] Aborted session ${sessionID} due to error`);
				} catch (abortError) {
					await logger.warn(`[${operationId}] Failed to abort session ${sessionID}: ${abortError}`);
				}
			}

			// End the timer even on error
			await logger.endTimerWithMessage(`ask-${operationId}`, `Question failed for ${tech}`);
			throw error;
		}
	}
}
