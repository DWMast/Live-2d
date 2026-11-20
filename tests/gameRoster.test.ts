import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameRoster } from '../src/utils/bd2Assets.ts';
import type { GameId } from '../src/types/bd2.ts';

const games: GameId[] = ['destinychild', 'girlssymphony', 'azurlane', 'echocalypse'];

test('external game catalogs map to complete playable roster entries', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    const match = /^\/data\/([a-z]+)_catalog\.json$/.exec(url);
    if (!match) return new Response('not found', { status: 404 });
    const body = await readFile(new URL(`../public${url}`, import.meta.url), 'utf8');
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };

  for (const game of games) {
    const roster = await loadGameRoster(game);
    assert.ok(roster.length > 0, `${game} roster must not be empty`);
    assert.ok(roster.every((entry) => entry.game === game));
    assert.ok(roster.every((entry) => entry.charName && entry.costumeName));
  }

  const destinyChild = await loadGameRoster('destinychild');
  assert.equal(destinyChild.length, 2464);
  assert.ok(destinyChild.every((entry) => entry.cubismApi === 'cubism2'));
  assert.ok(destinyChild.every((entry) => entry.live2dModelUrl?.startsWith('/api/dc-live2d/')));
  assert.ok(destinyChild.every((entry) => entry.iconUrl));
  assert.equal(destinyChild.filter((entry) => entry.uncensored).length, 230);

  const girlsSymphony = await loadGameRoster('girlssymphony');
  assert.ok(girlsSymphony.every((entry) => entry.cubismApi === 'cubism4'));

  for (const game of ['azurlane', 'echocalypse'] as const) {
    const roster = await loadGameRoster(game);
    assert.ok(roster.every((entry) => entry.skeletonUrl && entry.atlasUrl));
  }
});
