# @beda.software/ai-scribe-client

The client side of the AI scribe: framework-free TypeScript for web and React Native apps that capture a visit's
speech and turn it into a transcript with speakers, using the AI scribe service. It holds no UI and no app state.

## Installation

```sh
yarn add @beda.software/ai-scribe-client
```

Peer dependencies: `@beda.software/remote-data`, and optionally `axios` for the `Service` type.

## Transcription

`@beda.software/ai-scribe-client/transcription` (also re-exported from the package root).

| Area                   | What it does                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectRealtime`      | Opens an OpenAI Realtime transcription session over WebSocket with an ephemeral token, streams microphone chunks, emits every server event, and keeps each phrase's clip (`takeClip`) even when transcripts arrive out of order. |
| `createDiarizer`       | Diarizes phrases against one visit's speaker samples: one call at a time until every sample slot is taken, then in parallel.                                                                                                     |
| `diarizeClip`          | Sends a clip and the known speakers' samples to the AI scribe service's `/v2/transcribe` with diarization.                                                                                                                       |
| Transcript messages    | `insertMessage`, `getDiarizationOutcome`, `applyDiarization`, `splitPhraseAudio` and friends: functions that take a message list and return a new one, for any store.                                                            |
| `buildWav`, `getLevel` | A WAV file from 24 kHz PCM16 samples, and a chunk's level.                                                                                                                                                                       |

The app supplies what differs per platform and backend: the microphone, the ephemeral token request, an HTTP client
bound to the AI scribe service's base URL (`service`, any `(axiosConfig) => Promise<RemoteDataResult>`), how a WAV is
attached to a form on React Native (`AttachWav`) and where messages are stored.

### Vocabulary

- **phrase**: one realtime item, the speech server voice detection cuts between pauses, keyed by `item_id`;
- **segment**: one speaker's part of a phrase, as the diarizer returns it;
- **message**: one transcript entry. A phrase is one message until it is diarized, then one message per segment.

## Releasing

Publishing a GitHub release runs `.github/workflows/publish.yml`, which publishes to npm with provenance through npm
trusted publishing (no token). A release marked as a prerelease is published under the `alpha` tag, any other under
`latest`.

## Development

Prerequisites: Node `^22.18.0 || ^24.11.0 || >=26` and Corepack (pins Yarn 4 via `packageManager`).

```sh
corepack enable
yarn install
yarn typecheck
yarn check
yarn test
```
