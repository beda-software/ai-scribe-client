import { describe, expect, it } from 'vite-plus/test';
import {
    appendToClipBuffer,
    buildWav,
    ClipBuffer,
    convertFloatToInt16,
    createClipBuffer,
    cutClip,
    dropAudioBefore,
    encodeBase64,
    getEndMs,
    getLevel,
    getSpokenAt,
    resampleTo24k,
} from './audio.js';

const buildRamp = (length: number): Float32Array => Float32Array.from({ length }, (_, i) => i / (length - 1));

describe('resampleTo24k', () => {
    it('halves a 48 kHz chunk and keeps its endpoints', () => {
        const output = resampleTo24k(buildRamp(4800), 48000);
        expect(output).toHaveLength(2400);
        expect(output[0]).toBe(0);
        expect(output[2399]).toBeCloseTo(4798 / 4799, 6);
    });

    it('interpolates a 44.1 kHz chunk to 100 ms of 24 kHz', () => {
        const input = buildRamp(4410);
        const output = resampleTo24k(input, 44100);
        expect(output).toHaveLength(2400);
        expect(output[0]).toBe(0);
        expect(output[2399]).toBeCloseTo((2399 * 1.8375) / 4409, 6);
    });

    it('passes 24 kHz through unchanged', () => {
        const input = buildRamp(10);
        expect(resampleTo24k(input, 24000)).toBe(input);
    });
});

describe('convertFloatToInt16', () => {
    it('scales to the full range and clips out-of-range samples', () => {
        const output = convertFloatToInt16(Float32Array.from([0, 1, -1, 1.5, -2, 0.5]));
        expect(Array.from(output)).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
    });
});

describe('encodeBase64', () => {
    it('encodes little-endian PCM16 bytes', () => {
        expect(encodeBase64(Int16Array.from([1, -1]))).toBe(btoa(String.fromCharCode(1, 0, 255, 255)));
    });
});

describe('getLevel', () => {
    it('is the RMS of the chunk', () => {
        expect(getLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    });

    it('is zero for silence and an empty chunk', () => {
        expect(getLevel(new Float32Array(10))).toBe(0);
        expect(getLevel(new Float32Array(0))).toBe(0);
    });
});

describe('clip buffer', () => {
    // 24 samples per ms, sent as four 2.5 ms chunks; sample i holds i so positions are readable.
    const buildBuffer = (): ClipBuffer => {
        const buffer = createClipBuffer();
        for (let chunk = 0; chunk < 4; chunk++) {
            appendToClipBuffer(buffer, {
                samples: Int16Array.from({ length: 60 }, (_, i) => chunk * 60 + i),
                sentAt: 0,
                isSilence: false,
            });
        }
        return buffer;
    };

    it('cuts a range spanning chunks by ms', () => {
        const clip = cutClip(buildBuffer(), 2, 5);
        expect(Array.from(clip)).toEqual(Array.from({ length: 72 }, (_, i) => 48 + i));
    });

    it('tracks the session end in ms', () => {
        expect(getEndMs(buildBuffer())).toBe(10);
    });

    it('drops only whole chunks ending before the cutoff and keeps session positions', () => {
        const buffer = buildBuffer();

        dropAudioBefore(buffer, 5);
        expect(buffer.chunks).toHaveLength(2);
        expect(Array.from(cutClip(buffer, 6, 7))).toEqual(Array.from({ length: 24 }, (_, i) => 144 + i));
    });

    it('returns silence for dropped audio and clamps past the end', () => {
        const buffer = buildBuffer();
        dropAudioBefore(buffer, 5);

        const clip = cutClip(buffer, 4, 20);
        expect(clip).toHaveLength(144);
        expect(clip[0]).toBe(0);
        expect(clip[24]).toBe(120);
    });
});

describe('getSpokenAt', () => {
    // 100 ms chunks (2400 samples) sent at known clock times.
    const buildTimedBuffer = (chunks: Array<{ sentAt: number; isSilence: boolean }>): ClipBuffer => {
        const buffer = createClipBuffer();
        chunks.forEach(({ sentAt, isSilence }) =>
            appendToClipBuffer(buffer, { samples: new Int16Array(2400), sentAt, isSilence }),
        );
        return buffer;
    };

    it('places a position inside a chunk relative to when that chunk was sent', () => {
        const buffer = buildTimedBuffer([
            { sentAt: 10_100, isSilence: false },
            { sentAt: 10_200, isSilence: false },
        ]);
        expect(getSpokenAt(buffer, 150, 99_999)).toBe(10_150);
    });

    it('moves a position inside made-up silence to where real audio resumed', () => {
        const buffer = buildTimedBuffer([
            { sentAt: 10_100, isSilence: false },
            { sentAt: 10_100, isSilence: true },
            { sentAt: 60_100, isSilence: false },
        ]);
        expect(getSpokenAt(buffer, 150, 99_999)).toBe(60_000);
    });

    it('falls back to now minus the audio sent since the position when no chunk holds it', () => {
        const buffer = buildTimedBuffer([{ sentAt: 10_100, isSilence: false }]);
        expect(getSpokenAt(buffer, 300, 50_000)).toBe(50_200);
    });
});

describe('buildWav', () => {
    it('writes a mono 24 kHz PCM16 RIFF header followed by the samples', () => {
        const wav = buildWav(Int16Array.from([1, -2, 0x7fff]));
        const view = new DataView(wav.buffer);
        const readAscii = (offset: number): string => String.fromCharCode(...wav.subarray(offset, offset + 4));
        expect(wav).toHaveLength(50);
        expect(readAscii(0)).toBe('RIFF');
        expect(view.getUint32(4, true)).toBe(42);
        expect(readAscii(8)).toBe('WAVE');
        expect(readAscii(12)).toBe('fmt ');
        expect(view.getUint32(16, true)).toBe(16);
        expect(view.getUint16(20, true)).toBe(1);
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(24000);
        expect(view.getUint32(28, true)).toBe(48000);
        expect(view.getUint16(32, true)).toBe(2);
        expect(view.getUint16(34, true)).toBe(16);
        expect(readAscii(36)).toBe('data');
        expect(view.getUint32(40, true)).toBe(6);
        expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([1, -2, 0x7fff]);
    });
});
