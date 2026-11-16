import test from 'node:test';
import assert from 'node:assert/strict';

import player38 from '../src/vendor/spine-player3.8.js';
import player40 from '../src/vendor/spine-player4.0.js';
import player42 from '../src/vendor/spine-player4.2.js';

/**
 * Regression guard for "Please specify the URL of the skeleton JSON or .skel
 * file." Every Echocalypse skeleton is 3.8.x, so the 3.8 player is the one
 * that runs for them, and it ignores `binaryUrl` completely. Emitting only
 * `binaryUrl` made every Echocalypse character fail to open.
 *
 * `skeletonConfigFor` is private to EchoSpineViewer (which pulls in React and
 * WebGL), so this mirrors its contract against the real vendored players:
 * whatever key set we emit must survive each player's own validateConfig.
 */
const SKEL = 'http://localhost:3000/res/common/knight_spine/700010/700010.skel';
const ATLAS = 'http://localhost:3000/res/common/knight_spine/700010/700010.atlas';

type Player = { SpinePlayer: { prototype: { validateConfig: (c: unknown) => void } } };

const RUNTIMES: Array<[string, Player, string[]]> = [
  // [runtime version, module, keys the player actually reads]
  ['3.8', player38 as unknown as Player, ['skelUrl']],
  ['4.0', player40 as unknown as Player, ['binaryUrl']],
  ['4.2', player42 as unknown as Player, ['skeleton', 'skelUrl', 'binaryUrl']],
];

/** Mirrors skeletonConfigFor in EchoSpineViewer.tsx. */
function skeletonConfigFor(version: string, url: string, isJson: boolean): Record<string, string> {
  if (isJson) return { jsonUrl: url };
  if (version === '3.8') return { skelUrl: url };
  if (version === '4.0') return { binaryUrl: url };
  return { skeleton: url, skelUrl: url, binaryUrl: url };
}

function validate(mod: Player, config: Record<string, string>): void {
  const fake = Object.create(mod.SpinePlayer.prototype) as {
    validateConfig: (c: unknown) => void;
  };
  fake.validateConfig({ ...config, atlasUrl: ATLAS });
}

test('the old binaryUrl-only config reproduces the reported error on 3.8', () => {
  assert.throws(
    () => validate(player38 as unknown as Player, { binaryUrl: SKEL }),
    /Please specify the URL of the skeleton JSON or \.skel file\./,
    '3.8 must reject binaryUrl - this is the bug being guarded against'
  );
});

test('every runtime accepts the config we emit for it', () => {
  for (const [version, mod] of RUNTIMES) {
    const config = skeletonConfigFor(version, SKEL, false);
    assert.doesNotThrow(
      () => validate(mod, config),
      `${version} rejected its own binary skeleton config: ${JSON.stringify(config)}`
    );
  }
});

test('the emitted config always carries a key that runtime actually reads', () => {
  for (const [version, mod, readKeys] of RUNTIMES) {
    const config = skeletonConfigFor(version, SKEL, false);
    assert.ok(
      readKeys.some((k) => typeof config[k] === 'string' && config[k].length > 0),
      `${version} reads only ${readKeys.join('/')} but got ${JSON.stringify(config)}`
    );
    assert.doesNotThrow(() => validate(mod, config));
  }
});

test('a JSON skeleton uses jsonUrl, which every runtime accepts', () => {
  for (const [version, mod] of RUNTIMES) {
    const config = skeletonConfigFor(version, '/x/700010.json', true);
    assert.deepEqual(config, { jsonUrl: '/x/700010.json' });
    assert.doesNotThrow(() => validate(mod, config), `${version} rejected jsonUrl`);
  }
});
