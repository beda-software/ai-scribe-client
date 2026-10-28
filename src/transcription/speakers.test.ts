import { describe, expect, it } from 'vite-plus/test';
import { convertMsToSamples } from './audio.js';
import { getVoiceprintName, identifySpeakers, validateKnownVoiceprints } from './speakers.js';

const buildClip = (seconds: number): Int16Array =>
    Int16Array.from({ length: convertMsToSamples(seconds * 1000) }, (_, i) => i);

const clip = buildClip(10);

const cutClip = (start: number, end: number): Int16Array =>
    clip.slice(convertMsToSamples(start * 1000), convertMsToSamples(end * 1000));

describe('identifySpeakers with one voiceprint slot', () => {
    it('gives no voice an id while none is long enough for a voiceprint', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 0.8, text: 'Hello.' },
                { speaker: 'B', start: 1, end: 1.9, text: 'Hello.' },
            ],
            [],
            1,
        );
        expect(identified).toEqual({ speakerIdsByLabel: new Map(), voiceprints: [] });
    });

    it('takes a voiceprint of a long voice after a short one as B, and gives the short one the id left', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 0.8, text: 'Hello, doctor.' },
                { speaker: 'B', start: 1, end: 4, text: 'Hello, how are you feeling?' },
            ],
            [],
            1,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ A: 'A', B: 'B' });
        expect(identified.voiceprints).toEqual([{ speakerId: 'B', audioSamples: cutClip(1, 4) }]);
        expect(identified.voiceprints[0]!.audioSamples.buffer).not.toBe(clip.buffer);
    });

    it('keeps an id for a new voiceprint when short voices before it use up the ids', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 0.5, text: 'Hi.' },
                { speaker: 'B', start: 0.5, end: 1, text: 'Hi.' },
                { speaker: 'C', start: 1, end: 4, text: 'Good morning, everyone.' },
            ],
            [],
            1,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ A: 'A', B: 'A', C: 'B' });
    });

    it("gives the voiceprint's voice its id and every other voice the id left", () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 1, text: 'Hi.' },
                { speaker: getVoiceprintName('B'), start: 1, end: 2, text: 'Hello.' },
                { speaker: 'C', start: 2, end: 3, text: 'Me too.' },
            ],
            [{ speakerId: 'B', audioSamples: buildClip(3) }],
            1,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({
            A: 'A',
            [getVoiceprintName('B')]: 'B',
            C: 'A',
        });
    });

    it('lengthens a voiceprint only with a longer cut of its voice, up to 5 s', () => {
        const voiceprint = { speakerId: 'A', audioSamples: buildClip(4) };
        const getVoiceprintsAfter = (end: number) =>
            identifySpeakers(
                clip,
                [{ speaker: getVoiceprintName('A'), start: 0, end, text: 'Words.' }],
                [voiceprint],
                1,
            ).voiceprints;
        expect(getVoiceprintsAfter(3)).toEqual([voiceprint]);
        expect(getVoiceprintsAfter(9)).toEqual([{ speakerId: 'A', audioSamples: cutClip(0, 5) }]);
    });

    it('never takes a voiceprint from a segment without words', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 3, text: ' ' },
                { speaker: 'B', start: 3, end: 6, text: 'Hello, how are you feeling?' },
            ],
            [],
            1,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ B: 'A' });
        expect(identified.voiceprints).toEqual([{ speakerId: 'A', audioSamples: cutClip(3, 6) }]);
    });
});

describe('identifySpeakers with two voiceprint slots', () => {
    it('takes voiceprints of two long voices in speaking order, and gives a short one before them the id left', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 0.5, text: 'Hi.' },
                { speaker: 'B', start: 0.5, end: 3, text: 'Good morning, doctor.' },
                { speaker: 'C', start: 3, end: 6, text: 'Good morning, how is she?' },
            ],
            [],
            2,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ A: 'A', B: 'B', C: 'C' });
        expect(identified.voiceprints.map((voiceprint) => voiceprint.speakerId)).toEqual(['B', 'C']);
    });

    it('gives a short new voice no id while a voiceprint slot is free', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: getVoiceprintName('A'), start: 0, end: 1, text: 'Hello.' },
                { speaker: 'A', start: 1, end: 1.5, text: 'Hi.' },
            ],
            [{ speakerId: 'A', audioSamples: buildClip(3) }],
            2,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ [getVoiceprintName('A')]: 'A' });
    });

    it('gives every voice besides the two with voiceprints C', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: getVoiceprintName('A'), start: 0, end: 1, text: 'Hello.' },
                { speaker: getVoiceprintName('B'), start: 1, end: 2, text: 'Hi.' },
                { speaker: 'A', start: 2, end: 3, text: 'Me too.' },
            ],
            [
                { speakerId: 'A', audioSamples: buildClip(3) },
                { speakerId: 'B', audioSamples: buildClip(3) },
            ],
            2,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({
            [getVoiceprintName('A')]: 'A',
            [getVoiceprintName('B')]: 'B',
            A: 'C',
        });
    });
});

describe('validateKnownVoiceprints', () => {
    const voiceprintOf = (speakerId: string) => ({ speakerId, audioSamples: buildClip(3) });

    it('accepts known voiceprints with their own letters among the visit ids', () => {
        expect(() => validateKnownVoiceprints([voiceprintOf('A')], 1)).not.toThrow();
        expect(() => validateKnownVoiceprints([voiceprintOf('B')], 1)).not.toThrow();
        expect(() => validateKnownVoiceprints([voiceprintOf('A'), voiceprintOf('C')], 2)).not.toThrow();
    });

    it('rejects an id outside the visit letters, a repeated letter, or more voiceprints than slots', () => {
        expect(() => validateKnownVoiceprints([voiceprintOf('provider')], 1)).toThrow();
        expect(() => validateKnownVoiceprints([voiceprintOf('C')], 1)).toThrow();
        expect(() => validateKnownVoiceprints([voiceprintOf('A'), voiceprintOf('A')], 2)).toThrow();
        expect(() => validateKnownVoiceprints([voiceprintOf('A'), voiceprintOf('B')], 1)).toThrow();
    });
});
