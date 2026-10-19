import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { convertMsToSamples } from './audio.js';
import { connectRealtime } from './realtime.js';

class FakeSocket {
    static readonly OPEN = 1;
    static latest: FakeSocket;

    readyState = 0;
    sent: Array<{ type: string; [key: string]: unknown }> = [];
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onclose?: (event: { code: number; reason: string }) => void;
    onerror?: (error: unknown) => void;

    constructor(
        readonly url: string,
        readonly protocols: string[],
    ) {
        FakeSocket.latest = this;
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: 'closed' });
    }

    open(): void {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
    }

    receive(event: object): void {
        this.onmessage?.({ data: JSON.stringify(event) });
    }
}

describe('connectRealtime', () => {
    beforeEach(() => {
        vi.stubGlobal('WebSocket', FakeSocket);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('configures the session on open and resolves once the server confirms it', async () => {
        const connecting = connectRealtime({ token: 'ek_1', silenceMs: 600 });
        const socket = FakeSocket.latest;
        socket.open();
        socket.receive({ type: 'session.updated' });
        await connecting;
        expect(socket.url).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime');
        expect(socket.protocols).toEqual(['realtime', 'openai-insecure-api-key.ek_1']);
        expect(socket.sent[0]).toMatchObject({
            type: 'session.update',
            session: { audio: { input: { turn_detection: { silence_duration_ms: 600, create_response: false } } } },
        });
    });

    it('fails to connect when the socket closes before the session is configured', async () => {
        const connecting = connectRealtime({ token: 'ek_1' });
        FakeSocket.latest.close();
        await expect(connecting).rejects.toThrow('closed before the session was configured');
    });

    it('fails to connect when the server never confirms the session', async () => {
        vi.useFakeTimers();
        const connecting = connectRealtime({ token: 'ek_1' });
        FakeSocket.latest.open();
        vi.advanceTimersByTime(10_000);
        await expect(connecting).rejects.toThrow('not configured in time');
    });

    it('closes the phrase in progress on pause with silence a little longer than voice detection waits for', async () => {
        const connecting = connectRealtime({ token: 'ek_1', silenceMs: 800 });
        const socket = FakeSocket.latest;
        socket.open();
        socket.receive({ type: 'session.updated' });
        const session = await connecting;

        session.pause();
        const append = socket.sent[socket.sent.length - 1]!;
        expect(append.type).toBe('input_audio_buffer.append');
        expect(atob(append.audio as string)).toHaveLength(convertMsToSamples(1000) * Int16Array.BYTES_PER_ELEMENT);
    });
});
