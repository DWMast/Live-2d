import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAttachmentVertices,
  extractBoundaryPolylines,
  findTopHitSlot,
  hitTestAttachment,
  HitTestSlotLike,
  VertexAttachmentLike,
} from '../src/utils/spineHitTest';

test('RegionAttachment uses slot.bone in Spine 3.8/4.0 and falls back safely', () => {
  const bone = { worldX: 100, worldY: 200 };
  const slot: HitTestSlotLike = {
    data: { name: 'bow_region' },
    bone,
    color: { r: 1, g: 1, b: 1, a: 1 },
    getAttachment: () => attachment,
  };

  // Mimics Spine 3.8 RegionAttachment.computeWorldVertices(bone, out, offset, stride)
  const attachment: VertexAttachmentLike = {
    region: { texture: {} },
    computeWorldVertices: (...args: unknown[]) => {
      const [arg0, out, offset, stride] = args as [
        { worldX?: number; worldY?: number },
        Float32Array,
        number,
        number,
      ];
      const x = arg0.worldX!;
      const y = arg0.worldY!;
      // If called with `slot` instead of `slot.bone`, x & y are undefined -> NaN!
      out[offset] = x - 20;
      out[offset + 1] = y - 10;
      out[offset + stride] = x - 20;
      out[offset + stride + 1] = y + 10;
      out[offset + stride * 2] = x + 20;
      out[offset + stride * 2 + 1] = y + 10;
      out[offset + stride * 3] = x + 20;
      out[offset + stride * 3 + 1] = y - 10;
    },
  };

  const res38 = computeAttachmentVertices(slot, attachment, '3.8');
  assert.equal(res38.count, 8);
  assert.equal(res38.vertices[0], 80);
  assert.equal(res38.vertices[1], 190);

  // Even without runtimeVersion hint, finite check recovers by retrying slot.bone
  const resAuto = computeAttachmentVertices(slot, attachment);
  assert.equal(resAuto.count, 8);
  assert.equal(resAuto.vertices[0], 80);
});

test('MeshAttachment hit-testing uses triangles instead of crisscrossing unordered vertices', () => {
  // Concave C-shaped / U-shaped mesh with internal vertex ordering that breaks raw polygon parity
  // Vertices 0..4 form an inverted order if walked linearly
  const vertices = new Float32Array([
    0, 0,     // 0: bottom-left
    100, 0,   // 1: bottom-right
    50, 20,   // 2: inner center (creates crossing edges in linear order!)
    100, 100, // 3: top-right
    0, 100,   // 4: top-left
  ]);
  const mesh: VertexAttachmentLike = {
    worldVerticesLength: vertices.length,
    region: { texture: {} },
    // Two triangles forming a valid lower trapezoid + right wing, leaving top-left pocket empty
    triangles: [0, 1, 2, 1, 3, 2],
    uvs: new Float32Array([0, 1, 1, 1, 0.5, 0.8, 1, 0, 0, 0]),
  };

  // Point inside triangle [1, 3, 2]
  assert.equal(hitTestAttachment(80, 50, vertices, vertices.length, mesh), true);
  // Point inside empty top-left pocket outside all triangles
  assert.equal(hitTestAttachment(20, 60, vertices, vertices.length, mesh), false);
});

test('findTopHitSlot passes through transparent atlas padding, hidden/zero-alpha slots, and non-renderable attachments', () => {
  const mkRegionSlot = (
    name: string,
    rect: [number, number, number, number],
    alpha = 1,
    isTransparentAtCenter = false
  ): HitTestSlotLike => {
    const att: VertexAttachmentLike = {
      region: { texture: { _image: { name } as unknown as CanvasImageSource } },
      uvs: new Float32Array([0, 1, 0, 0, 1, 0, 1, 1]),
      computeWorldVertices: (...args: unknown[]) => {
        const [, out] = args as [unknown, Float32Array];
        const [x0, y0, x1, y1] = rect;
        out[0] = x0; out[1] = y0;
        out[2] = x0; out[3] = y1;
        out[4] = x1; out[5] = y1;
        out[6] = x1; out[7] = y0;
      },
    };
    (att as Record<string, unknown>).__transparentCenter = isTransparentAtCenter;
    return {
      data: { name },
      bone: {},
      color: { r: 1, g: 1, b: 1, a: alpha },
      getAttachment: () => att,
    };
  };

  const clipSlot: HitTestSlotLike = {
    data: { name: 'clip_mask' },
    bone: {},
    color: { r: 1, g: 1, b: 1, a: 1 },
    getAttachment: () => null,
  };
  const clippedTarget = mkRegionSlot('clipped_prop', [-100, -100, 100, 100], 1, false);
  const clipAtt: VertexAttachmentLike = {
    worldVerticesLength: 8,
    endSlot: clippedTarget,
    computeWorldVertices: (...args: unknown[]) => {
      const [, , , out] = args as [unknown, number, number, Float32Array];
      // Clip polygon is ONLY [50..80, 50..80]
      out[0] = 50; out[1] = 50;
      out[2] = 50; out[3] = 80;
      out[4] = 80; out[5] = 80;
      out[6] = 80; out[7] = 50;
    },
  };
  clipSlot.getAttachment = () => clipAtt;

  const boundingBoxSlot: HitTestSlotLike = {
    data: { name: 'bbox' },
    bone: {},
    color: { r: 1, g: 1, b: 1, a: 1 },
    getAttachment: () => ({
      worldVerticesLength: 8,
      // No `.region` -> BoundingBox/Path/Point attachment
      computeWorldVertices: (...args: unknown[]) => {
        const [, , , out] = args as [unknown, number, number, Float32Array];
        out[0] = -200; out[1] = -200;
        out[2] = -200; out[3] = 200;
        out[4] = 200; out[5] = 200;
        out[6] = 200; out[7] = -200;
      },
    }),
  };

  const drawOrder: HitTestSlotLike[] = [
    mkRegionSlot('body', [-100, -100, 100, 100], 1, false),
    mkRegionSlot('bow', [-20, -20, 20, 20], 1, false),
    mkRegionSlot('hidden_expr', [-20, -20, 20, 20], 0, false),
    mkRegionSlot('hair_padding', [-40, -40, 40, 40], 1, true),
    clipSlot,
    clippedTarget,
    boundingBoxSlot,
  ];

  // Center (0, 0):
  // - boundingBoxSlot ignored (no region)
  // - clippedTarget ignored (outside clip_mask [50..80])
  // - hair_padding ignored (alpha=0 at center)
  // - hidden_expr ignored (slot.color.a === 0)
  // -> hits `bow`!
  const hit = findTopHitSlot({
    drawOrder,
    worldX: 0,
    worldY: 0,
    hiddenLayers: new Set(),
    runtimeVersion: '3.8',
    sampleAlpha: (att) => ((att as Record<string, unknown>).__transparentCenter ? 0 : 255),
  });
  assert.equal(hit, 'bow');

  // Inside clip_mask (60, 60) -> hits `clipped_prop`
  const hitClipped = findTopHitSlot({
    drawOrder,
    worldX: 60,
    worldY: 60,
    hiddenLayers: new Set(),
    runtimeVersion: '3.8',
    sampleAlpha: (att) => ((att as Record<string, unknown>).__transparentCenter ? 0 : 255),
  });
  assert.equal(hitClipped, 'clipped_prop');
});

test('extractBoundaryPolylines cleanly separates disconnected mesh islands and drops internal edges', () => {
  // Island 1: quad (0,1,2) & (0,2,3); Island 2: triangle (4,5,6)
  const triangles = [0, 1, 2, 0, 2, 3, 4, 5, 6];
  const loops = extractBoundaryPolylines(triangles);
  assert.equal(loops.length, 2);
  assert.equal(loops[0].length, 4);
  assert.equal(loops[1].length, 3);
});
