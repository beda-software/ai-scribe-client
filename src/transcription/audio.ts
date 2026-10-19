export const OUTPUT_SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const WAV_FORMAT_PCM = 1;

// One sent chunk; `start` is its position in the session audio, in 24 kHz samples, and `sentAt` the clock time
// its last sample was sent. `isSilence` marks padding the app made up, which no one spoke.
interface SentChunk {
    start: number;
    samples: Int16Array;
    sentAt: number;
    isSilence: boolean;
}

// The 24 kHz Int16 audio sent this session, as chunks; older chunks are dropped once no phrase needs them.
export interface ClipBuffer {
    chunks: SentChunk[];
    endSample: number;
}

export function createClipBuffer(): ClipBuffer {
    return { chunks: [], endSample: 0 };
}

/** Linear-interpolation resample of one chunk to 24 kHz. */
export function resampleTo24k(samples: Float32Array, inputRate: number): Float32Array {
    if (inputRate === OUTPUT_SAMPLE_RATE) {
        return samples;
    }

    const step = inputRate / OUTPUT_SAMPLE_RATE;
    const output = new Float32Array(Math.round(samples.length / step));
    for (let i = 0; i < output.length; i++) {
        const position = i * step;
        const left = Math.floor(position);
        const right = Math.min(left + 1, samples.length - 1);
        const fraction = position - left;
        output[i] = samples[left]! * (1 - fraction) + samples[right]! * fraction;
    }
    return output;
}

export function convertFloatToInt16(samples: Float32Array): Int16Array {
    const output = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]!));
        output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
}

export function encodeBase64(samples: Int16Array): string {
    const bytes = getBytes(samples);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}

/** RMS of a chunk, 0..1. */
export function getLevel(samples: Float32Array): number {
    if (samples.length === 0) {
        return 0;
    }

    let sumOfSquares = 0;
    for (let i = 0; i < samples.length; i++) {
        sumOfSquares += samples[i]! * samples[i]!;
    }
    return Math.min(1, Math.sqrt(sumOfSquares / samples.length));
}

export function appendToClipBuffer(buffer: ClipBuffer, chunk: Omit<SentChunk, 'start'>): void {
    buffer.chunks.push({ ...chunk, start: buffer.endSample });
    buffer.endSample += chunk.samples.length;
}

/** Copies [startMs, endMs) of the session audio; samples already dropped come back as silence. */
export function cutClip(buffer: ClipBuffer, startMs: number, endMs: number): Int16Array {
    const start = convertMsToSamples(startMs);
    const end = Math.min(convertMsToSamples(endMs), buffer.endSample);
    const clip = new Int16Array(Math.max(0, end - start));
    for (const chunk of buffer.chunks) {
        const from = Math.max(start, chunk.start);
        const to = Math.min(end, chunk.start + chunk.samples.length);
        if (from < to) {
            clip.set(chunk.samples.subarray(from - chunk.start, to - chunk.start), from - start);
        }
    }
    return clip;
}

/** A view of [startSeconds, endSeconds) of 24 kHz samples; an end past them stops at their end. */
export function cutSeconds(samples: Int16Array, startSeconds: number, endSeconds: number): Int16Array {
    return samples.subarray(convertMsToSamples(startSeconds * 1000), convertMsToSamples(endSeconds * 1000));
}

/** Drops whole chunks that end at or before `ms`. */
export function dropAudioBefore(buffer: ClipBuffer, ms: number): void {
    const cutoff = convertMsToSamples(ms);
    const firstKept = buffer.chunks.findIndex((chunk) => chunk.start + chunk.samples.length > cutoff);
    buffer.chunks.splice(0, firstKept === -1 ? buffer.chunks.length : firstKept);
}

export function getEndMs(buffer: ClipBuffer): number {
    return (buffer.endSample * 1000) / OUTPUT_SAMPLE_RATE;
}

export function convertMsToSamples(ms: number): number {
    return Math.round((ms * OUTPUT_SAMPLE_RATE) / 1000);
}

/** Clock time of a session-audio position; inside made-up silence it moves to where real audio resumes. */
export function getSpokenAt(buffer: ClipBuffer, audioStartMs: number, now: number): number {
    const position = convertMsToSamples(audioStartMs);
    const firstIndex = buffer.chunks.findIndex((chunk) => position < chunk.start + chunk.samples.length);
    const chunk = firstIndex === -1 ? undefined : buffer.chunks.slice(firstIndex).find((c) => !c.isSilence);
    if (!chunk) {
        return now - (getEndMs(buffer) - audioStartMs);
    }

    const samplesBeforeEnd = chunk.start + chunk.samples.length - Math.max(position, chunk.start);
    return chunk.sentAt - (samplesBeforeEnd * 1000) / OUTPUT_SAMPLE_RATE;
}

/** Wraps 24 kHz mono PCM16 samples in a 44-byte RIFF/WAVE header. */
export function buildWav(samples: Int16Array): Uint8Array {
    const dataBytes = samples.byteLength;
    const wav = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
    const view = new DataView(wav.buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, WAV_FORMAT_PCM, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
    view.setUint32(28, OUTPUT_SAMPLE_RATE * BYTES_PER_SAMPLE, true);
    view.setUint16(32, BYTES_PER_SAMPLE, true);
    view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);
    wav.set(getBytes(samples), WAV_HEADER_BYTES);
    return wav;
}

function writeAscii(view: DataView, offset: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
    }
}

// Int16Array is little-endian on every target, which is what PCM16 expects.
function getBytes(samples: Int16Array): Uint8Array {
    return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}
