import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLive2DZoom,
  createLive2DLayerController,
  createLive2DLayerPicker,
  zoomLive2DCameraAtPoint,
  MAX_LIVE2D_ZOOM,
  MIN_LIVE2D_ZOOM,
} from '../src/utils/live2dControls.ts';

test('Cubism zoom keeps the model point under the cursor stationary', () => {
  const fit = { scale: 0.5, x: 40, y: 20 };
  const initial = { zoom: 1, panX: 12, panY: -8 };
  const point = { x: 320, y: 180 };
  const localX = (point.x - fit.x - initial.panX) / (fit.scale * initial.zoom);
  const localY = (point.y - fit.y - initial.panY) / (fit.scale * initial.zoom);

  const zoomed = zoomLive2DCameraAtPoint(initial, fit, point, 2.5);
  assert.equal(zoomed.zoom, 2.5);
  assert.equal(fit.x + zoomed.panX + localX * fit.scale * zoomed.zoom, point.x);
  assert.equal(fit.y + zoomed.panY + localY * fit.scale * zoomed.zoom, point.y);

  const restored = zoomLive2DCameraAtPoint(zoomed, fit, point, 1);
  assert.deepEqual(restored, initial);
  assert.equal(clampLive2DZoom(0), MIN_LIVE2D_ZOOM);
  assert.equal(clampLive2DZoom(1000), MAX_LIVE2D_ZOOM);
});

test('Cubism 4 parts stay hidden after pose updates and restore their own opacity', () => {
  const ids = ['PartBody', 'PartCoat'];
  const opacities = new Float32Array([1, 0.65]);
  const coreModel = {
    getModel: () => ({ parts: { count: 2, ids, opacities } }),
    getPartOpacityByIndex: (index: number) => opacities[index],
    setPartOpacityByIndex: (index: number, opacity: number) => {
      opacities[index] = opacity;
    },
  };
  const controller = createLive2DLayerController({ coreModel });

  assert.deepEqual(controller.layers, ids);
  const hidden = new Set(['PartCoat']);
  controller.apply(hidden);
  assert.equal(opacities[1], 0);

  // Simulate the runtime pose system writing part opacity on the next frame.
  opacities[1] = 0.8;
  controller.apply(hidden);
  assert.equal(opacities[1], 0, 'the pose update must not reveal a hidden part');

  controller.apply(new Set());
  assert.ok(Math.abs(opacities[1] - 0.65) < 1e-6, 'restore the opacity captured before hiding');
  assert.equal(opacities[0], 1);
});

test('Cubism 2 part metadata supports delete, repeated updates, and undo', () => {
  const partIds = [{ id: 'PARTS_01_BODY' }, { id: 'PARTS_02_CLOTHES' }];
  const opacities = [1, 1];
  const coreModel = {
    getModelContext: () => ({
      _$F2: partIds.map((id) => ({ _$p2: () => id })),
    }),
    getPartsDataIndex: (id: string) => partIds.findIndex((part) => part.id === id),
    getPartsOpacity: (index: number) => opacities[index],
    setPartsOpacity: (index: number, opacity: number) => {
      opacities[index] = opacity;
    },
  };
  const controller = createLive2DLayerController({ coreModel });

  assert.deepEqual(controller.layers, partIds.map((part) => part.id));
  controller.apply(new Set(['PARTS_02_CLOTHES']));
  assert.deepEqual(opacities, [1, 0]);
  controller.apply(new Set(['PARTS_02_CLOTHES']));
  assert.deepEqual(opacities, [1, 0]);
  controller.apply(new Set());
  assert.deepEqual(opacities, [1, 1]);
});

test('Cubism 4 click picking follows render order, parent parts, and triangles', () => {
  const vertices = [
    new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]),
    new Float32Array([0, 0, 100, 0, 0, 100]),
  ];
  const coreModel = {
    getModel: () => ({
      parts: { ids: ['PartBody', 'PartCoat'] },
      drawables: { parentPartIndices: new Int32Array([0, 1]) },
    }),
    getDrawableParentPartIndex: (index: number) => index,
    getDrawableVertexIndices: (index: number) =>
      index === 0 ? new Uint16Array([0, 1, 2, 0, 2, 3]) : new Uint16Array([0, 1, 2]),
    getDrawableRenderOrders: () => new Int32Array([1, 0]),
    getDrawableDynamicFlagIsVisible: () => true,
    getDrawableOpacity: () => 1,
  };
  const picker = createLive2DLayerPicker({
    coreModel,
    getDrawableIDs: () => ['BodyMesh', 'CoatMesh'],
    getDrawableVertices: (index: number) => vertices[index],
  });

  assert.equal(picker(25, 25, new Set()), 'PartBody', 'render order puts Body above Coat');
  assert.equal(picker(25, 25, new Set(['PartBody'])), 'PartCoat', 'hidden parts fall through');
  assert.equal(picker(90, 90, new Set()), 'PartBody', 'triangle test avoids empty Coat bounds');
  assert.equal(picker(150, 150, new Set()), null);
});

test('Cubism 2 click picking maps draw data to parts and skips hidden opacity', () => {
  const part = (id: string, drawId: string) => ({
    getPartsID: () => ({ id }),
    getDrawData: () => [{ getDrawDataID: () => ({ id: drawId }) }],
  });
  const partIds = ['PARTS_BODY', 'PARTS_COAT'];
  const opacities = [1, 1];
  const coreModel = {
    getModelContext: () => ({
      _$F2: [part(partIds[0], 'D_BODY'), part(partIds[1], 'D_COAT')],
    }),
    getPartsDataIndex: (id: string) => partIds.indexOf(id),
    getPartsOpacity: (index: number) => opacities[index],
  };
  const picker = createLive2DLayerPicker({
    coreModel,
    getDrawableIDs: () => ['D_BODY', 'D_COAT'],
    getDrawableVertices: () => new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]),
  });

  assert.equal(picker(50, 50, new Set()), 'PARTS_COAT');
  assert.equal(picker(50, 50, new Set(['PARTS_COAT'])), 'PARTS_BODY');
  opacities[1] = 0;
  assert.equal(picker(50, 50, new Set()), 'PARTS_BODY', 'invisible pose parts fall through');
});
