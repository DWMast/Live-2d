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
    __contractOriginalUpdate?: (useMipMaps: boolean) => void;
  };
  DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL?: boolean;
}

export interface ContractState {
  /** What the atlas declares (from its `pma` key). */
  blendPma: boolean;
  /** What the uploader will be told to do. Must equal blendPma. */
  uploadPma: boolean;
  /** Mipmaps enabled for this model. */
  mipmaps: boolean;
  /** Anisotropy cap applied to texture sampling. */
  anisotropy: number;
  /** True once the GLTexture prototype has been patched for this contract. */
  patched: boolean;
}

const MAX_ANISOTROPY = 8;

/**
 * Patch `GLTexture.prototype.update` for every bundled runtime so the unpack
 * flag is set explicitly on each upload, matching the model's atlas.
 *
 * `SpinePlayer.premultipliedAlpha` only affects the *blend* side; nothing in the
 * stock runtime sets the unpack flag unless `DISABLE_UNPACK_PREMULTIPLIED_ALPHA_
 * WEBGL` happens to be true, in which case it forces the flag to `false`. Leaving
 * it alone means the flag keeps whatever value the GL context last had - normally
 * the browser default of `true` - regardless of what the atlas actually contains.
 */
export function applyTextureContract(
  TextureCtor: unknown,
  opts: { blendPma: boolean; mipmaps: boolean; anisotropy?: number }
): ContractState {
  const ctor = TextureCtor as TextureCtor | undefined;
  const state: ContractState = {
    blendPma: opts.blendPma,
    uploadPma: opts.blendPma,
    mipmaps: opts.mipmaps,
    anisotropy: opts.anisotropy ?? MAX_ANISOTROPY,
    patched: false,
  };
  const proto = ctor?.prototype;
  if (!ctor || !proto || typeof proto.update !== 'function') return state;

  // Force the runtime's own flag to the state we actually want, and keep the
  // original update so repeated calls across model switches do not stack wrappers.
  ctor.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = !state.uploadPma;
  const original = proto.__contractOriginalUpdate ?? proto.update;
  proto.__contractOriginalUpdate = original;

  const anisotropy = state.anisotropy;
  const wantMipmaps = state.mipmaps;

  proto.update = function (this: unknown, useMipMaps: boolean) {
    const self = this as {
      context?: { gl?: WebGLRenderingContext | WebGL2RenderingContext };
    };
    const gl = self.context?.gl;
    const mipmaps = useMipMaps || wantMipmaps;

    if (gl && !gl.isContextLost()) {
      // The one line that decides whether edges are correct.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, state.uploadPma ? 1 : 0);
    }

    original.call(this, mipmaps);

    if (gl && !gl.isContextLost() && mipmaps) {
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
  };

  state.patched = true;
  return state;
}
