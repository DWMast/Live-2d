import type * as spine41 from '@esotericsoftware/spine-player';

declare module '../vendor/spine-player4.0.js' {
  const spine40: {
    SpinePlayer: typeof spine41.SpinePlayer;
    GLTexture: typeof spine41.GLTexture;
    OrthoCamera: typeof spine41.OrthoCamera;
    Vector2: typeof spine41.Vector2;
    Vector3: typeof spine41.Vector3;
    Skeleton: typeof spine41.Skeleton;
    Downloader: typeof spine41.Downloader;
  };
  export default spine40;
}
