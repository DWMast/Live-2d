import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteLive2DManifestFileRefs } from '../server/live2dManifest.ts';

test('Cubism 4 manifest encodes fragments in file paths but not motion group names', () => {
  const settings = {
    Version: 3,
    FileReferences: {
      Moc: 'scene.moc3',
      Textures: ['textures/texture_00 #3.png'],
      Motions: {
        '#idle': [{ File: 'motions/touch #1.motion3.json' }],
      },
      Expressions: [{ Name: '#smile', File: 'expressions/smile #1.exp3.json' }],
      Physics: { File: 'scene #physics.physics3.json' },
    },
  };
  const rewritten = JSON.parse(rewriteLive2DManifestFileRefs(JSON.stringify(settings)));
  assert.equal(rewritten.FileReferences.Textures[0], 'textures/texture_00 %233.png');
  assert.equal(rewritten.FileReferences.Motions['#idle'][0].File, 'motions/touch %231.motion3.json');
  assert.equal(rewritten.FileReferences.Expressions[0].File, 'expressions/smile %231.exp3.json');
  assert.equal(rewritten.FileReferences.Expressions[0].Name, '#smile');
  assert.equal(rewritten.FileReferences.Physics.File, 'scene %23physics.physics3.json');
  assert.equal(rewritten.FileReferences.Moc, 'scene.moc3');
});

test('Cubism 2 manifest encodes model texture motion and physics references', () => {
  const settings = {
    model: 'model.moc',
    textures: ['textures/texture #1.png'],
    motions: { idle: [{ file: 'motions/idle #1.mtn' }] },
    expressions: [{ name: '#smile', file: 'expressions/smile #1.exp.json' }],
    physics: 'physics #1.json',
    pose: 'pose #1.json',
  };
  const rewritten = JSON.parse(rewriteLive2DManifestFileRefs(JSON.stringify(settings)));
  assert.equal(rewritten.textures[0], 'textures/texture %231.png');
  assert.equal(rewritten.motions.idle[0].file, 'motions/idle %231.mtn');
  assert.equal(rewritten.expressions[0].file, 'expressions/smile %231.exp.json');
  assert.equal(rewritten.expressions[0].name, '#smile');
  assert.equal(rewritten.physics, 'physics %231.json');
  assert.equal(rewritten.pose, 'pose %231.json');
});

test('manifest rewriting is idempotent and preserves manifests without fragments', () => {
  const original = '{"FileReferences":{"Moc":"scene.moc3","Textures":["texture.png"]}}';
  assert.equal(rewriteLive2DManifestFileRefs(original), original);
  const once = rewriteLive2DManifestFileRefs('{"model":"model #1.moc","textures":["texture #1.png"]}');
  const twice = rewriteLive2DManifestFileRefs(once);
  assert.deepEqual(JSON.parse(twice), JSON.parse(once));
});
