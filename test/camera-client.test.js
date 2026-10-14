import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestAuthorization, parseDigestChallenge } from '../src/camera-client.js';

test('Digest bate com o exemplo da RFC 2617', () => {
  const challenge = parseDigestChallenge(
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
  );
  const header = digestAuthorization(challenge, {
    username: 'Mufasa', password: 'Circle Of Life', method: 'GET', uri: '/dir/index.html', cnonce: '0a4f113b',
  });
  assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(header, /nc=00000001/);
});

test('parseDigestChallenge ignora Basic e rejeita algoritmo desconhecido', () => {
  assert.equal(parseDigestChallenge('Basic realm="x"'), null);
  assert.throws(() => parseDigestChallenge('Digest realm="x", nonce="y", algorithm=SHA-512-256'), /não suportado/);
});
