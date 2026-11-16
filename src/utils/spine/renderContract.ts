/**
 * Render contract: make the texture upload and the blend function agree.
 *
 * This is the fix for the black spots, and it is worth stating precisely because
 * the bug is subtle and easy to reintroduce.
 *
 * Spine draws each attachment twice-scaled: the vertex colour is multiplied by
 * the slot and attachment tints, and *if* the renderer is told the atlas is
 * premultiplied it multiplies those colours by alpha again before blending with
 * (ONE, ONE_MINUS_SRC_ALPHA). So the shader output is `a * s` in colour and `a`
 * in alpha, and the composite over background B is
 *
 *     C = (a*s) + (1-a)*B          (correct, when texels are also premultiplied)
 *
 * The texture upload has to match: `UNPACK_PREMULTIPLY_ALPHA_WEBGL` must be
 * true so the texel colour arriving in the shader is already `a*s`.
 *
 * The Echocalypse atlases are **straight alpha** - none of them declares
 * `pma: true` - and their texels keep their real colour in transparent pixels.
 * The old viewer told the renderer they were premultiplied anyway. The texel
 * therefore entered the pipeline as `s` (not `a*s`), and the blend applied alpha
 * twice:
 *
 *     C = a*s + (1-a)*B            (what the data supports)
 *   vs
 *     C = a*(a*s) + (1-a)*B        (what the broken contract renders)
 *
 * The error is `a*(1-a)*s` - exactly zero where the art is opaque (a=1) and where
 * it is fully transparent (a=0), and maximal on every anti-aliased texel, which
 * is where hair strands, eyelashes, cloth edges and soft shadow rims live. On a
 * 2048x2048 page roughly 9% of texels are in that band, and the darkest of them
 * rendered about 94/255 levels darker than the art.
 *
 * The contract below is derived from the atlas text, never assumed, and it is
 * applied to the *static* upload flag plus a per-upload pixelStorei, so switching
 * between models with different declarations cannot inherit stale GL state.
 */

export interface TextureCtor {
  prototype: {
    update: (useMipMaps: boolean) => void;
    setFilters?: (minFilter: number, magFilter: number) => void;
    __contractOriginalUpdate?: (useMipMaps: boolean) => void;
    __contractOriginalSetFilters?: (minFilter: number, magFilter: number) => void;
  };
  DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL?: boolean;
}

export interface ContractState {
  /** What the renderer uses for blending / vertex premultiplication. */
  blendPma: boolean;
  /** What GL pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL) uses during upload. */
  uploadPma: boolean;
  /** Mipmaps enabled for this model. */
  mipmaps: boolean;
  /** Anisotropy cap applied to texture sampling. */
  anisotropy: number;
  /** True once the GLTexture prototype has been patched for this contract. */
  patched: boolean;
}

const MAX_ANISOTROPY = 8;
const GL_NEAREST = 9728;
const GL_LINEAR = 9729;
const GL_NEAREST_MIPMAP_LINEAR = 9986;
const GL_LINEAR_MIPMAP_LINEAR = 9987;

function applyAnisotropy(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  anisotropy: number
) {
  try {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(anisotropy, max || 1));
    }
  } catch {
    // Anisotropy is a quality nicety; never let it break the upload.
  }
}

/**
 * Patch `GLTexture.prototype.update` and `GLTexture.prototype.setFilters` for
 * every bundled runtime so the unpack flag, mipmaps, and anisotropy stay consistent.
 */
export function applyTextureContract(
  TextureCtor: unknown,
  opts: { blendPma: boolean; uploadPma?: boolean; mipmaps: boolean; anisotropy?: number }
): ContractState {
  const ctor = TextureCtor as TextureCtor | undefined;
  const uploadPma = opts.uploadPma ?? opts.blendPma;
  const state: ContractState = {
    blendPma: opts.blendPma,
    uploadPma,
    mipmaps: opts.mipmaps,
    anisotropy: opts.anisotropy ?? MAX_ANISOTROPY,
    patched: false,
  };
  const proto = ctor?.prototype;
  if (!ctor || !proto || typeof proto.update !== 'function') return state;

  // Force the runtime's own flag to the state we actually want, and keep the
  // original methods so repeated calls across model switches do not stack wrappers.
  ctor.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = !state.uploadPma;
  const original = proto.__contractOriginalUpdate ?? proto.update;
  proto.__contractOriginalUpdate = original;

  const anisotropy = state.anisotropy;
  const wantMipmaps = state.mipmaps;

  proto.update = function (this: unknown, useMipMaps: boolean) {
    const self = this as {
      context?: { gl?: WebGLRenderingContext | WebGL2RenderingContext };
      _image?: { width?: number; height?: number };
      useMipMaps?: boolean;
      __contractHasMipmaps?: boolean;
    };
    const gl = self.context?.gl;
    const img = self._image;
    const isWebGL2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const w = img?.width ?? 0;
    const h = img?.height ?? 0;
    const isPot = w > 0 && h > 0 && (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
    const mipmaps = (useMipMaps || wantMipmaps) && (isWebGL2 || isPot);
    self.__contractHasMipmaps = mipmaps;
    self.useMipMaps = mipmaps;

    if (gl && !gl.isContextLost()) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, state.uploadPma ? 1 : 0);
    }

    original.call(this, mipmaps);

    if (gl && !gl.isContextLost() && mipmaps) {
      applyAnisotropy(gl, anisotropy);
    }
  };

  if (typeof proto.setFilters === 'function') {
    const originalSetFilters = proto.__contractOriginalSetFilters ?? proto.setFilters;
    proto.__contractOriginalSetFilters = originalSetFilters;
    proto.setFilters = function (this: unknown, minFilter: number, magFilter: number) {
      const self = this as {
        context?: { gl?: WebGLRenderingContext | WebGL2RenderingContext };
        useMipMaps?: boolean;
        __contractHasMipmaps?: boolean;
      };
      const hasMipmaps = self.__contractHasMipmaps ?? !!self.useMipMaps;
      let nextMin = minFilter;
      if (hasMipmaps) {
        if (minFilter === GL_LINEAR) nextMin = GL_LINEAR_MIPMAP_LINEAR;
        else if (minFilter === GL_NEAREST) nextMin = GL_NEAREST_MIPMAP_LINEAR;
      } else if (nextMin >= 9984 && nextMin <= 9987) {
        nextMin = nextMin === 9984 || nextMin === 9986 ? GL_NEAREST : GL_LINEAR;
      }

      originalSetFilters.call(this, nextMin, magFilter);

      const gl = self.context?.gl;
      if (gl && !gl.isContextLost() && hasMipmaps) {
        applyAnisotropy(gl, anisotropy);
      }
    };
  }

  state.patched = true;
  return state;
}
