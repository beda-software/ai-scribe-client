import { describe, expect, it } from 'vite-plus/test';
import { convertMsToSamples } from './audio.js';
import { getSampleName, identifySpeakers } from './speakers.js';

const buildClip = (seconds: number): Int16Array =>
    Int16Array.from({ length: convertMsToSamples(seconds * 1000) }, (_, i) => i);

const clip = buildClip(10);

const cutClip = (start: number, end: number): Int16Array =>
    clip.slice(convertMsToSamples(start * 1000), convertMsToSamples(end * 1000));

describe('identifySpeakers with one sampled speaker', () => {
    it('gives no voice an id while none is long enough to sample', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 0.8, text: 'Hello.' },
                { speaker: 'B', start: 1, end: 1.9, text: 'Hello.' },
            ],
            [],
            1,
        );
        expect(identified).toEqual({ speakerIdsByLabel: new Map(), speakerSamples: [] });
    });

    it('samples a long voice after a short one as B, and gives the short one the id left', () => {
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
        expect(identified.speakerSamples).toEqual([{ speakerId: 'B', samples: cutClip(1, 4) }]);
        expect(identified.speakerSamples[0]!.samples.buffer).not.toBe(clip.buffer);
    });

    it('keeps the id for a sampled voice when short voices before it use up the ids', () => {
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

    it('gives the sampled voice its id and every other voice the id left', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: 'A', start: 0, end: 1, text: 'Hi.' },
                { speaker: getSampleName('B'), start: 1, end: 2, text: 'Hello.' },
                { speaker: 'C', start: 2, end: 3, text: 'Me too.' },
            ],
            [{ speakerId: 'B', samples: buildClip(3) }],
            1,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ A: 'A', [getSampleName('B')]: 'B', C: 'A' });
    });

    it('lengthens a sample only with a longer cut of its voice, up to 5 s', () => {
        const sample = { speakerId: 'A', samples: buildClip(4) };
        const getSamplesAfter = (end: number) =>
            identifySpeakers(clip, [{ speaker: getSampleName('A'), start: 0, end, text: 'Words.' }], [sample], 1)
                .speakerSamples;
        expect(getSamplesAfter(3)).toEqual([sample]);
        expect(getSamplesAfter(9)).toEqual([{ speakerId: 'A', samples: cutClip(0, 5) }]);
    });

    it('never samples a segment without words', () => {
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
        expect(identified.speakerSamples).toEqual([{ speakerId: 'A', samples: cutClip(3, 6) }]);
    });
});

describe('identifySpeakers with two sampled speakers', () => {
    it('samples two long voices in speaking order, and gives a short one before them the id left', () => {
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
        expect(identified.speakerSamples.map((sample) => sample.speakerId)).toEqual(['B', 'C']);
    });

    it('gives a short new voice no id while a sample slot is free', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: getSampleName('A'), start: 0, end: 1, text: 'Hello.' },
                { speaker: 'A', start: 1, end: 1.5, text: 'Hi.' },
            ],
            [{ speakerId: 'A', samples: buildClip(3) }],
            2,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({ [getSampleName('A')]: 'A' });
    });

    it('gives every voice besides the two sampled ones C', () => {
        const identified = identifySpeakers(
            clip,
            [
                { speaker: getSampleName('A'), start: 0, end: 1, text: 'Hello.' },
                { speaker: getSampleName('B'), start: 1, end: 2, text: 'Hi.' },
                { speaker: 'A', start: 2, end: 3, text: 'Me too.' },
            ],
            [
                { speakerId: 'A', samples: buildClip(3) },
                { speakerId: 'B', samples: buildClip(3) },
            ],
            2,
        );
        expect(Object.fromEntries(identified.speakerIdsByLabel)).toEqual({
            [getSampleName('A')]: 'A',
            [getSampleName('B')]: 'B',
            A: 'C',
        });
    });
});
