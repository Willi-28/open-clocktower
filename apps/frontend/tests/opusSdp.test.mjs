import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

function loadOpusSdp() {
  const source = readFileSync(new URL('../src/audio/opusSdp.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: 'opusSdp.ts' }).runInNewContext({ exports: module.exports, module });
  return module.exports;
}

const { tuneOpusSdp } = loadOpusSdp();

const defaultTuning = {
  maxAverageBitrate: 64000,
  forwardErrorCorrection: true,
  discontinuousTransmission: false,
};

// Typical Chrome offer: opus with an existing fmtp line. Existing parameters
// must survive, tuned ones must be set exactly once.
const chromeSdp = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=rtpmap:9 G722/8000',
  '',
].join('\r\n');

const tunedChrome = tuneOpusSdp(chromeSdp, defaultTuning);
const fmtpLine = tunedChrome.split('\r\n').find((line) => line.startsWith('a=fmtp:111 '));
assert.ok(fmtpLine, 'fmtp line exists');
assert.match(fmtpLine, /minptime=10/, 'existing parameter preserved');
assert.match(fmtpLine, /useinbandfec=1/, 'FEC on');
assert.match(fmtpLine, /usedtx=0/, 'DTX off');
assert.match(fmtpLine, /stereo=0/, 'mono');
assert.match(fmtpLine, /sprop-stereo=0/, 'mono sprop');
assert.match(fmtpLine, /maxaveragebitrate=64000/, 'bitrate applied');
assert.match(fmtpLine, /maxplaybackrate=48000/, 'fullband playback');
assert.equal(tunedChrome.match(/a=fmtp:111 /g).length, 1, 'no duplicate fmtp lines');
assert.ok(tunedChrome.includes('a=rtpmap:9 G722/8000'), 'other codecs untouched');

// An offer without an fmtp line for opus gains one directly after the rtpmap.
const bareSdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 opus/48000/2', 'a=sendrecv', ''].join('\r\n');
const tunedBare = tuneOpusSdp(bareSdp, defaultTuning);
const bareLines = tunedBare.split('\r\n');
const rtpmapIndex = bareLines.indexOf('a=rtpmap:96 opus/48000/2');
assert.ok(bareLines[rtpmapIndex + 1].startsWith('a=fmtp:96 '), 'fmtp inserted after rtpmap');
assert.match(bareLines[rtpmapIndex + 1], /useinbandfec=1/, 'FEC in inserted line');

// Toggled flags land in the output.
const toggled = tuneOpusSdp(chromeSdp, {
  maxAverageBitrate: 32000,
  forwardErrorCorrection: false,
  discontinuousTransmission: true,
});
const toggledFmtp = toggled.split('\r\n').find((line) => line.startsWith('a=fmtp:111 '));
assert.match(toggledFmtp, /useinbandfec=0/, 'FEC off when disabled');
assert.match(toggledFmtp, /usedtx=1/, 'DTX on when enabled');
assert.match(toggledFmtp, /maxaveragebitrate=32000/, 'custom bitrate');

// SDP without opus stays byte-identical.
const videoOnly = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 100', 'a=rtpmap:100 VP8/90000', ''].join('\r\n');
assert.equal(tuneOpusSdp(videoOnly, defaultTuning), videoOnly, 'non-opus SDP untouched');

console.log('opusSdp.test.mjs passed');
