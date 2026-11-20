import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getSpineModelUrls, loadGameRoster } from '../src/utils/bd2Assets.ts';
import type { GameId } from '../src/types/bd2.ts';

const games: GameId[] = [
  'destinychild',
  'girlssymphony',
  'azurlane',
  'echocalypse',
  'girlwars',
  'love3',
  'konfox',
  'sacredsword',
  'princessharem',
  'imokone',
];

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

  const konfox = await loadGameRoster('konfox');
  assert.equal(konfox.length, 300);
  assert.equal(konfox.filter((entry) => entry.kind === 'adult').length, 12);
  assert.ok(konfox.some((entry) => entry.charName === 'Konko'));
  assert.ok(konfox.some((entry) => entry.charName === 'Nanako'));
  assert.ok(konfox.every((entry) => entry.cubismApi === 'cubism2' && entry.iconUrl?.startsWith('/icons/konfox/')));
  assert.ok(konfox.every((entry) => entry.named && entry.live2dModelUrl?.startsWith('/api/gal-live2d/')));
  assert.ok(new Set(konfox.map((entry) => entry.iconUrl)).size >= 60);

  const sacredSword = await loadGameRoster('sacredsword');
  assert.equal(sacredSword.length, 12);
  assert.equal(sacredSword.filter((entry) => entry.kind === 'adult').length, 5);
  assert.ok(sacredSword.every((entry) => entry.cubismApi === 'cubism2' && entry.iconUrl?.startsWith('/icons/sacredsword/') && entry.named));
  assert.ok(sacredSword.every((entry) => entry.releaseLabel !== 'Cubism 4 Live2D'));

  const princessHarem = await loadGameRoster('princessharem');
  assert.equal(princessHarem.length, 5);
  assert.ok(princessHarem.every((entry) => entry.kind === 'adult' && entry.releaseLabel === 'Adult scene'));
  assert.ok(princessHarem.every((entry) => entry.cubismApi === 'cubism4' && entry.iconUrl?.startsWith('/icons/princessharem/') && entry.named));
  assert.ok(princessHarem.every((entry) => entry.live2dModelUrl?.startsWith('/api/gal-live2d/')));

  const imokone = await loadGameRoster('imokone');
  assert.equal(imokone.length, 18);
  assert.ok(imokone.some((entry) => entry.charName === 'Hagiwara Michiru (萩原満月)'));
  assert.ok(imokone.some((entry) => entry.charName === 'Enomoto Mikaru (榎本三日月)'));
  assert.ok(imokone.filter((entry) => entry.kind === 'adult').length >= 4);
  assert.ok(imokone.every((entry) => entry.cubismApi === 'cubism4' && entry.iconUrl?.startsWith('/icons/imokone/') && entry.named));
  assert.ok(imokone.every((entry) => entry.live2dModelUrl?.startsWith('/api/gal-live2d/')));

  const localIcons = new Set<string>();
  for (const roster of [konfox, sacredSword, princessHarem, imokone]) {
    for (const entry of roster) {
      if (entry.iconUrl) localIcons.add(entry.iconUrl);
    }
  }
  assert.equal(localIcons.size, 104);
  for (const url of localIcons) {
    const icon = await readFile(new URL(`../public${url}`, import.meta.url));
    assert.equal(icon.subarray(0, 4).toString(), 'RIFF', url);
    assert.equal(icon.subarray(8, 12).toString(), 'WEBP', url);
  }
});
