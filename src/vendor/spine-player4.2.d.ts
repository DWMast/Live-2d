import type * as spine41 from '@esotericsoftware/spine-player';

declare module '../vendor/spine-player4.2.js' {
  export const SpinePlayer: typeof spine41.SpinePlayer;
  export const GLTexture: typeof spine41.GLTexture;
  export const OrthoCamera: typeof spine41.OrthoCamera;
  export const Vector2: typeof spine41.Vector2;
  export const Vector3: typeof spine41.Vector3;
  export const Downloader: typeof spine41.Downloader;
  const spine42: {
    SpinePlayer: typeof spine41.SpinePlayer;
    GLTexture: typeof spine41.GLTexture;
    OrthoCamera: typeof spine41.OrthoCamera;
    Vector2: typeof spine41.Vector2;
    Vector3: typeof spine41.Vector3;
    Downloader: typeof spine41.Downloader;
    Physics?: { none: number; reset: number; update: number; pose: number };
  };
  export default spine42;
}
