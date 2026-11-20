import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getSpineModelUrls, loadGameRoster } from '../src/utils/bd2Assets.ts';
import type { GameId } from '../src/types/bd2.ts';

const games: GameId[] = ['destinychild', 'girlssymphony', 'azurlane', 'echocalypse', 'girlwars', 'love3'];

test('external game catalogs map to complete playable roster entries', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    const match = /^\/data\/([a-z0-9]+)_catalog\.json$/.exec(url);
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
  assert.ok(
    destinyChild.every((entry) => !['', '???', 'unknown'].includes(entry.charName.trim().toLowerCase()))
  );
  assert.equal(destinyChild.filter((entry) => entry.uncensored).length, 230);

  const girlsSymphony = await loadGameRoster('girlssymphony');
  assert.ok(girlsSymphony.every((entry) => entry.cubismApi === 'cubism4'));

  for (const game of ['azurlane', 'echocalypse', 'girlwars'] as const) {
    const roster = await loadGameRoster(game);
    assert.ok(roster.every((entry) => entry.skeletonUrl && entry.atlasUrl));
  }

  const girlWars = await loadGameRoster('girlwars');
  assert.equal(girlWars.length, 141);
  assert.equal(girlWars.filter((entry) => entry.modelType === 'cutscene').length, 0);
  assert.equal(girlWars.filter((entry) => entry.hasCutscene).length, 140);
  assert.ok(girlWars.every((entry) => entry.iconUrl && entry.spineVersion === '4.0'));

  const tsurihime = girlWars.find((entry) => entry.id === 'gw_1001');
  assert.ok(tsurihime?.hasCutscene);
  const standing = getSpineModelUrls(tsurihime, 'character');
  const cutscene = getSpineModelUrls(tsurihime, 'cutscene');
  assert.notEqual(cutscene.skeletonUrl, standing.skeletonUrl);
  assert.notEqual(cutscene.atlasUrl, standing.atlasUrl);
  assert.match(cutscene.skeletonUrl, /\/cutscene\//);
  assert.equal(cutscene.isJson, false);
  assert.ok(girlWars.every((entry) => getSpineModelUrls(entry, 'character').skeletonUrl));
  assert.ok(
    girlWars.every((entry) =>
      !entry.hasCutscene || getSpineModelUrls(entry, 'cutscene').skeletonUrl.includes('/cutscene/')
    )
  );

  const love3 = await loadGameRoster('love3');
  assert.equal(love3.length, 26);
  assert.equal(love3.filter((entry) => entry.kind === 'adult').length, 6);
  assert.ok(love3.every((entry) => entry.cubismApi === 'cubism4' && entry.iconUrl));
  assert.ok(love3.every((entry) => entry.live2dModelUrl?.startsWith('/api/gal-live2d/')));
});
