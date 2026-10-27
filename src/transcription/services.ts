import { failure, RemoteDataResult } from '@beda.software/remote-data';

import { buildWav } from './audio.js';
import type { KnownSpeaker } from './diarization.js';
import type { Service } from '../types.js';
import type { DiarizedTranscript } from './types.js';

const TRANSCRIBE_TIMEOUT_MS = 60000;
export const WAV_FILE_NAME = 'clip.wav';
export const WAV_MIME_TYPE = 'audio/wav';

// Puts a WAV into a form field; returns what to clean up once the form is sent.
export type AttachWav = (form: FormData, field: string, wav: Uint8Array) => (() => void) | void;

export async function diarizeClip(
    service: Service,
    clip: Int16Array,
    knownSpeakers: KnownSpeaker[],
    attachWav: AttachWav,
): Promise<RemoteDataResult<DiarizedTranscript>> {
    let release = (): void => undefined;
    try {
        const built = buildDiarizeForm(clip, knownSpeakers, attachWav);
        release = built.release;
        return await service<DiarizedTranscript>({
            method: 'POST',
            url: '/v3/transcribe',
            data: built.form,
            // A JSON default content type would make React Native serialize the form; browsers add the boundary themselves.
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: TRANSCRIBE_TIMEOUT_MS,
        });
    } catch (error) {
        return failure(error);
    } finally {
        release();
    }
}

export function buildDiarizeForm(
    clip: Int16Array,
    knownSpeakers: KnownSpeaker[],
    attachWav: AttachWav,
): { form: FormData; release: () => void } {
    const form = new FormData();
    const releases: Array<() => void> = [];
    const attach = (field: string, samples: Int16Array): void => {
        const release = attachWav(form, field, buildWav(samples));
        if (release) {
            releases.push(release);
        }
    };

    const release = (): void => releases.forEach((releaseWav) => releaseWav());
    try {
        attach('file', clip);
        knownSpeakers.forEach(({ name, samples }) => {
            form.append('speaker', name);
            attach('sample', samples);
        });
    } catch (error) {
        release();
        throw error;
    }

    form.append('diarize', 'true');
    return { form, release };
}

export const attachWavBlob: AttachWav = (form, field, wav) => {
    // TypeScript 5.7+ types a plain Uint8Array as possibly backed by a SharedArrayBuffer, which Blob rejects.
    form.append(field, new Blob([wav as BlobPart], { type: WAV_MIME_TYPE }), WAV_FILE_NAME);
};
