import { convertFloatToInt16, convertMsToSamples, encodeBase64, OUTPUT_SAMPLE_RATE, resampleTo24k } from './audio.js';
import { createPhraseTracker, PhraseClip, RealtimeEvent } from './phrases.js';

const DEFAULT_MODEL = 'gpt-realtime';
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_SILENCE_MS = 800;
// A pause sends a little more silence than server VAD needs, so the last phrase is transcribed.
const PAUSE_EXTRA_SILENCE_MS = 200;
// Without it, a blackholed network holds the caller in "connecting" until the OS gives up on TCP.
const CONFIGURE_TIMEOUT_MS = 10000;

export interface RealtimeOptions {
    token: string;
    model?: string;
    language?: string;
    silenceMs?: number;
}

export interface RealtimeSession {
    // Every server event, plus the made-up `transport.closed` and `parse.error`.
    onEvent: (handler: (event: RealtimeEvent) => void) => () => void;
    sendAudio: (samples: Float32Array, inputRate: number) => void;
    // Sends the silence server VAD needs to close the phrase in progress.
    pause: () => void;
    clear: () => void;
    takeClip: (itemId: string) => PhraseClip | undefined;
    close: () => void;
}

/** Resolves once the session is configured, so a close before that is a connect failure the caller can retry. */
export async function connectRealtime({
    token,
    model = DEFAULT_MODEL,
    language = DEFAULT_LANGUAGE,
    silenceMs = DEFAULT_SILENCE_MS,
}: RealtimeOptions): Promise<RealtimeSession> {
    const eventHandlers = new Set<(event: RealtimeEvent) => void>();
    const emit = (event: RealtimeEvent): void => {
        try {
            eventHandlers.forEach((handler) => handler(event));
        } catch (e) {
            console.error('[AiScribe] Error in event handler:', e);
        }
    };
    const phrases = createPhraseTracker();
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, [
        'realtime',
        `openai-insecure-api-key.${token}`,
    ]);

    const sendSamples = (samples: Int16Array, isSilence: boolean): void => {
        if (socket.readyState !== WebSocket.OPEN) {
            return;
        }

        socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: encodeBase64(samples) }));
        phrases.addSentAudio(samples, isSilence);
    };

    let markConfigured: () => void = () => undefined;
    let failConfiguring: (error: Error) => void = () => undefined;
    const configured = new Promise<void>((resolve, reject) => {
        markConfigured = resolve;
        failConfiguring = reject;
    });
    const configureTimeout = setTimeout(() => {
        failConfiguring(new Error('Realtime session was not configured in time'));
        socket.close();
    }, CONFIGURE_TIMEOUT_MS);

    socket.onopen = () => socket.send(JSON.stringify(buildSessionUpdate(model, language, silenceMs)));
    socket.onmessage = (message: MessageEvent) => {
        let event: RealtimeEvent;
        try {
            event = JSON.parse(String(message.data));
        } catch (e) {
            emit({ type: 'parse.error', raw: message.data, error: String(e) });
            return;
        }

        if (event.type === 'session.updated') {
            clearTimeout(configureTimeout);
            markConfigured();
        }
        phrases.handleEvent(event);
        emit(event);
    };
    socket.onerror = (error: Event) => {
        console.error('[AiScribe] WebSocket error:', error);
    };
    socket.onclose = (event: CloseEvent) => {
        failConfiguring(new Error(`WebSocket closed before the session was configured: ${event.code} ${event.reason}`));
        emit({ type: 'transport.closed' });
    };
    await configured;

    return {
        onEvent: (handler) => {
            eventHandlers.add(handler);
            return () => {
                eventHandlers.delete(handler);
            };
        },
        sendAudio: (samples, inputRate) => sendSamples(convertFloatToInt16(resampleTo24k(samples, inputRate)), false),
        pause: () => sendSamples(new Int16Array(convertMsToSamples(silenceMs + PAUSE_EXTRA_SILENCE_MS)), true),
        clear: () => {
            phrases.dropOpenPhrase();
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
            }
        },
        takeClip: phrases.takeClip,
        close: () => socket.close(),
    };
}

// Transcription only: the model's responses are never read, so it isn't asked for any.
function buildSessionUpdate(model: string, language: string, silenceMs: number): object {
    return {
        type: 'session.update',
        session: {
            type: 'realtime',
            model,
            output_modalities: ['text'],
            audio: {
                input: {
                    format: { type: 'audio/pcm', rate: OUTPUT_SAMPLE_RATE },
                    transcription: { model: 'gpt-transcribe', language },
                    turn_detection: {
                        type: 'server_vad',
                        silence_duration_ms: silenceMs,
                        create_response: false,
                        interrupt_response: false,
                    },
                },
            },
        },
    };
}
