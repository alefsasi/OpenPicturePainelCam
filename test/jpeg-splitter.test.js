import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJpegSplitter } from '../src/jpeg-splitter.js';
import { fakeJpeg } from '../test-support/fake-ffmpeg.js';

test('separa quadros mesmo com cortes em qualquer posição (1 byte por vez)', () => {
  const frames = [];
  const push = createJpegSplitter((f) => frames.push(Buffer.from(f)));
  const stream = Buffer.concat([fakeJpeg(1), fakeJpeg(2), fakeJpeg(3)]);
  for (const byte of stream) push(Buffer.from([byte]));
  assert.deepEqual(frames, [fakeJpeg(1), fakeJpeg(2), fakeJpeg(3)]);
});

test('vários quadros num único pedaço', () => {
  const frames = [];
  const push = createJpegSplitter((f) => frames.push(Buffer.from(f)));
  push(Buffer.concat([fakeJpeg(1), fakeJpeg(2)]));
  assert.equal(frames.length, 2);
});

test('descarta lixo antes do SOI e ressincroniza', () => {
  const frames = [];
  const push = createJpegSplitter((f) => frames.push(Buffer.from(f)));
  push(Buffer.from([0x00, 0x11, 0xff]));
  push(Buffer.concat([fakeJpeg(7)]));
  assert.deepEqual(frames, [fakeJpeg(7)]);
});
