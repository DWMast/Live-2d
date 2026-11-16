import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTextureContract } from '../src/utils/spine/renderContract.ts';

test('applyTextureContract preserves LINEAR_MIPMAP_LINEAR when TextureAtlas calls setFilters', () => {
  const texParams: Array<{ pname: number; param: number }> = [];
  const fakeGl = {
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    TEXTURE_2D: 3553,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    NEAREST: 9728,
    LINEAR_MIPMAP_LINEAR: 9987,
    NEAREST_MIPMAP_LINEAR: 9986,
    isContextLost: () => false,
    pixelStorei: () => {},
    getExtension: () => null,
    texParameteri: (_target: number, pname: number, param: number) => {
      texParams.push({ pname, param });
    },
  };

  class FakeGLTexture {
    context = { gl: fakeGl };
    _image = { width: 2048, height: 2048 };
    useMipMaps = false;

    update(useMipMaps: boolean) {
      this.useMipMaps = useMipMaps;
    }

    setFilters(minFilter: number, magFilter: number) {
      fakeGl.texParameteri(fakeGl.TEXTURE_2D, fakeGl.TEXTURE_MIN_FILTER, minFilter);
      fakeGl.texParameteri(fakeGl.TEXTURE_2D, fakeGl.TEXTURE_MAG_FILTER, magFilter);
    }
  }

  const state = applyTextureContract(FakeGLTexture, {
    blendPma: false,
    mipmaps: true,
  });
  assert.equal(state.patched, true);
  assert.equal(state.uploadPma, false);

  const tex = new FakeGLTexture();
  tex.update(false);
  tex.setFilters(fakeGl.LINEAR, fakeGl.LINEAR);

  const minCall = texParams.find((c) => c.pname === fakeGl.TEXTURE_MIN_FILTER);
  assert.equal(
    minCall?.param,
    fakeGl.LINEAR_MIPMAP_LINEAR,
    'setFilters(LINEAR, LINEAR) must keep LINEAR_MIPMAP_LINEAR active when mipmaps are generated'
  );
});

test('applyTextureContract strips mipmap filter for NPOT textures under WebGL1', () => {
  const texParams: Array<{ pname: number; param: number }> = [];
  const fakeGl = {
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    TEXTURE_2D: 3553,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    LINEAR_MIPMAP_LINEAR: 9987,
    isContextLost: () => false,
    pixelStorei: () => {},
    getExtension: () => null,
    texParameteri: (_target: number, pname: number, param: number) => {
      texParams.push({ pname, param });
    },
  };

  class FakeGLTexture {
    context = { gl: fakeGl };
    _image = { width: 1500, height: 1500 }; // NPOT
    useMipMaps = false;
    update(useMipMaps: boolean) {
      this.useMipMaps = useMipMaps;
    }
    setFilters(minFilter: number, magFilter: number) {
      fakeGl.texParameteri(fakeGl.TEXTURE_2D, fakeGl.TEXTURE_MIN_FILTER, minFilter);
      fakeGl.texParameteri(fakeGl.TEXTURE_2D, fakeGl.TEXTURE_MAG_FILTER, magFilter);
    }
  }

  applyTextureContract(FakeGLTexture, { blendPma: false, mipmaps: true });
  const tex = new FakeGLTexture();
  tex.update(true);
  tex.setFilters(fakeGl.LINEAR_MIPMAP_LINEAR, fakeGl.LINEAR);

  const minCall = texParams.find((c) => c.pname === fakeGl.TEXTURE_MIN_FILTER);
  assert.equal(minCall?.param, fakeGl.LINEAR);
});
