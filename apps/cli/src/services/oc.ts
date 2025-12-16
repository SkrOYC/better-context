import {
	createOpencode,
	OpencodeClient,
	type Event,
	type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { Deferred, Duration, Effect, Ref, Stream } from 'effect';
import { ConfigService } from './config.ts';
import { OcError } from '../lib/errors.ts';
import { validateProviderAndModel } from '../lib/utils/validation.ts';



export type { Event as OcEvent };

const ocService = Effect.gen(function* () {
	const config = yield* ConfigService;

	const rawConfig = yield* config.rawConfig();

	const sessionsRef = yield* Ref.make(new Map<string, { client: OpencodeClient; server: { close: () => void; url: string } }>());

	const getOpencodeInstance = ({ tech }: { tech: string }) =>
		Effect.gen(function* () {
			let portOffset = 0;
			const maxInstances = 5;
			const configObject = yield* config.getOpenCodeConfig({ repoName: tech });

			while (portOffset < maxInstances) {
				const result = yield* Effect.tryPromise(() =>
					createOpencode({
						port: 3420 + portOffset,
						config: configObject
					})
				).pipe(
					Effect.catchAll((err) => {
						if (err.cause instanceof Error && err.cause.stack?.includes('port')) {
							portOffset++;
							return Effect.succeed(null);
						}
						return Effect.fail(
							new OcError({
								message: 'FAILED TO CREATE OPENCODE CLIENT',
								cause: err
							})
						);
					})
				);
				if (result !== null) {
					return result;
				}
			}
			return yield* Effect.fail(
				new OcError({
					message: 'FAILED TO CREATE OPENCODE CLIENT - all ports exhausted',
					cause: null
				})
			);
		});

	const streamSessionEvents = (args: { sessionID: string; client: OpencodeClient }) =>
		Effect.gen(function* () {
			const { sessionID, client } = args;

			const events = yield* Effect.tryPromise({
				try: () => client.event.subscribe(),
				catch: (err) =>
					new OcError({
						message: 'Failed to subscribe to events',
						cause: err
					})
			});

			return Stream.fromAsyncIterable(
				events.stream,
				(e) => new OcError({ message: 'Event stream error', cause: e })
			).pipe(
				Stream.filter((event) => {
					const props = event.properties;
					if (!('sessionID' in props)) return true;
					return props.sessionID === sessionID;
				}),
				Stream.takeUntil(
					(event) => event.type === 'session.idle' && event.properties.sessionID === sessionID
				)
			);
		});

	const firePrompt = (args: {
		sessionID: string;
		text: string;
		errorDeferred: Deferred.Deferred<never, OcError>;
		client: OpencodeClient;
	}) =>
		Effect.promise(() =>
			args.client.session.prompt({
				path: { id: args.sessionID },
				body: {
					agent: 'docs',
					model: {
						providerID: rawConfig.provider,
						modelID: rawConfig.model
					},
					parts: [{ type: 'text', text: args.text }]
				}
			})
		).pipe(
			Effect.catchAll((err) =>
				Deferred.fail(args.errorDeferred, new OcError({ message: String(err), cause: err }))
			)
		);

	const streamPrompt = (args: {
		sessionID: string;
		prompt: string;
		client: OpencodeClient;
		cleanup: () => void;
	}) =>
		Effect.gen(function* () {
			const { sessionID, prompt, client } = args;

			const eventStream = yield* streamSessionEvents({ sessionID, client });

			const errorDeferred = yield* Deferred.make<never, OcError>();

			yield* firePrompt({
				sessionID,
				text: prompt,
				errorDeferred,
				client
			}).pipe(Effect.forkDaemon);

			// Transform stream to fail on session.error, race with prompt error
			return eventStream.pipe(
				Stream.mapEffect((event) =>
					Effect.gen(function* () {
						if (event.type === 'session.error') {
							const props = event.properties as { error?: { name?: string } };
							return yield* Effect.fail(
								new OcError({
									message: props.error?.name ?? 'Unknown session error',
									cause: props.error
								})
							);
						}
						return event;
					})
				),
				Stream.ensuring(Effect.sync(() => args.cleanup())),
				Stream.interruptWhen(Deferred.await(errorDeferred))
			);
		});

	return {
		spawnTui: (args: { tech: string }) =>
			Effect.gen(function* () {
				const { tech } = args;

				yield* config.cloneOrUpdateOneRepoLocally(tech, { suppressLogs: false });

				// Launch the internal TUI by importing and calling launchTui
				const tuiModule = yield* Effect.promise(() => import('../tui/index.tsx'));
				yield* Effect.promise(async () => {
					await tuiModule.launchTui();
					// Keep the effect running, as the TUI exit is handled by process termination (Ctrl+C).
					return new Promise<void>(() => {});
				});
			}),
		initSession: (tech: string) =>
			Effect.gen(function* () {
				const { client, server } = yield* getOpencodeInstance({ tech });

				const session = yield* Effect.promise(() => client.session.create());

				if (session.error) {
					return yield* Effect.fail(
						new OcError({
							message: 'FAILED TO START OPENCODE SESSION',
							cause: session.error
						})
					);
				}

				const sessionID = session.data.id;

				yield* Ref.update(sessionsRef, (map) => map.set(sessionID, { client, server }));

				return sessionID;
			}),
		sendPrompt: (sessionId: string, text: string) =>
			Effect.gen(function* () {
				const sessions = yield* Ref.get(sessionsRef);
				const sessionData = sessions.get(sessionId);
				if (!sessionData) {
					return yield* Effect.fail(
						new OcError({
							message: 'Session not found',
							cause: null
						})
					);
				}
				const { client } = sessionData;

				return yield* streamPrompt({
					sessionID: sessionId,
					prompt: text,
					client,
					cleanup: () => {} // Session persists, no cleanup
				});
			}),
		closeSession: (sessionId: string) =>
			Effect.gen(function* () {
				const sessions = yield* Ref.get(sessionsRef);
				const sessionData = sessions.get(sessionId);
				if (sessionData) {
					sessionData.server.close();
					yield* Ref.update(sessionsRef, (map) => {
						map.delete(sessionId);
						return map;
					});
				}
			}),
		holdOpenInstanceInBg: () =>
			Effect.gen(function* () {
				const { client, server } = yield* getOpencodeInstance({
					tech: 'svelte'
				});

				yield* Effect.log(`OPENCODE SERVER IS UP AT ${server.url}`);

				yield* Effect.sleep(Duration.days(1));
			}),
		askQuestion: (args: { question: string; tech: string; suppressLogs: boolean }) =>
			Effect.gen(function* () {
				const { question, tech, suppressLogs } = args;

				yield* config.cloneOrUpdateOneRepoLocally(tech, { suppressLogs });

				const { client, server } = yield* getOpencodeInstance({ tech });

				yield* validateProviderAndModel(client, rawConfig.provider, rawConfig.model);

				const session = yield* Effect.promise(() => client.session.create());

				if (session.error) {
					return yield* Effect.fail(
						new OcError({
							message: 'FAILED TO START OPENCODE SESSION',
							cause: session.error
						})
					);
				}

				const sessionID = session.data.id;

				return yield* streamPrompt({
					sessionID,
					prompt: question,
					client,
					cleanup: () => {
						server.close();
					}
				});
			})
	};
});

export class OcService extends Effect.Service<OcService>()('OcService', {
	effect: ocService,
	dependencies: [ConfigService.Default]
}) {}
