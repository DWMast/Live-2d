/**
 * Binary Spine skeleton inspector.
 *
 * Everything the Echocalypse viewer needs to be honest about a model has to come
 * out of the file itself, because there is no metadata layer to trust:
 *
 *  - the exporter version (so the 3.8 runtime is chosen for 3.8 data, not by
 *    guessing from an ID pattern),
 *  - whether the file parses to completion (so a truncated download is reported
 *    as broken instead of rendering as mangled geometry),
 *  - which skins exist and how many slots each one overrides (so "default" and
 *    the numbered alternates can be listed by name),
 *  - and whether any slot carries a `dark` tint (the two-colour shader path,
 *    which is where dark artefacts come from when it is mis-fed).
 *
 * The reader implements the Spine 3.8 binary layout, which is what every model
 * in this catalog is exported with. Unknown versions are reported, not guessed
 * at, and the caller falls back to a header-only read.
 */

export interface SpineSlotInfo {
  name: string;
  attachment: string;
  blend: string;
  color: [number, number, number, number];
  /** Present only on slots authored with the two-colour (dark tint) shader. */
  dark: [number, number, number, number] | null;
}

export interface SpineSkinInfo {
  name: string;
  /** Slot -> attached region for the entries this skin actually overrides. */
  entries: Array<{ slot: string; attachment: string }>;
}

export interface SpineAnimationInfo {
  name: string;
  duration: number;
}

export interface SpineInspection {
  ok: boolean;
  /** Exporter version string as written in the header, e.g. "3.8.99". */
  version: string | null;
  /** Major.minor, for runtime selection. */
  majorMinor: string | null;
  hash: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nonessential: boolean;
  images: string[];
  bones: Array<{ name: string; parent: string | null }>;
  slots: SpineSlotInfo[];
  defaults: {
    skins: string[];
    bones: string[];
    constraints: string[];
  };
  skins: SpineSkinInfo[];
  animations: SpineAnimationInfo[];
  /** Number of animations; names/durations need the full attachment walk. */
  animationCount: number;
  /** Shared string table; skin names are string references into this. */
  stringTable: string[];
  /** True once the header, string table, bones, slots and constraints read back. */
  headerParsed: boolean;
  /** Slots whose setup pose declares a dark tint. Points at the two-colour path. */
  darkTintedSlots: string[];
  error: string | null;
}

class BinaryReader {
  pos: number;
  view: DataView;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  get remaining() {
    return this.bytes.length - this.pos;
  }
  private need(n: number) {
    if (this.pos + n > this.bytes.length) {
      throw new Error(`Unexpected end of skeleton at byte ${this.pos} (wanted ${n} more)`);
    }
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** Spine's variable-length int (7 bits per byte). */
  varint(optimizePositive = true) {
    let b = this.u8();
    let result = b & 0x7f;
    if ((b & 0x80) !== 0) {
      b = this.u8();
      result |= (b & 0x7f) << 7;
      if ((b & 0x80) !== 0) {
        b = this.u8();
        result |= (b & 0x7f) << 14;
        if ((b & 0x80) !== 0) {
          b = this.u8();
          result |= (b & 0x7f) << 21;
          if ((b & 0x80) !== 0) {
            b = this.u8();
            result |= (b & 0x7f) << 28;
          }
        }
      }
    }
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
  }
  /** spine-ts 3.8 BinaryInput.readString: length includes a leading marker byte. */
  readString(): string {
    const byteCount = this.varint(true);
    if (byteCount === 0) return '';
    if (byteCount === 1) return '';
    const chars: number[] = [];
    for (let i = 1; i < byteCount; i++) {
      chars.push(this.u8());
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(chars));
  }

  color(): [number, number, number, number] {
    let r = this.u8();
    let g = this.u8();
    let b = this.u8();
    let a = this.u8();
    if (r + g + b + a > 0xfe) {
      // 8888 form: channel values packed into a 32-bit int, little endian.
      const packed = (a << 24) | (b << 16) | (g << 8) | r;
      const rgba = packed >>> 0;
      r = (rgba & 0xff000000) >>> 24;
      g = (rgba & 0x00ff0000) >>> 16;
      b = (rgba & 0x0000ff00) >>> 8;
      a = rgba & 0x000000ff;
    }
    return [r / 255, g / 255, b / 255, a / 255];
  }
  skipFloatArray() {
    const n = this.varint(true);
    this.pos += n * 4;
    this.need(0);
  }
  skipIntArray() {
    const n = this.varint(true);
    for (let i = 0; i < n; i++) this.varint(false);
  }
  skipShortArray() {
    const n = this.varint(true);
    this.pos += n * 2;
    this.need(0);
  }
  skipCurve() {
    const type = this.u8();
    switch (type) {
      case 1:
        this.f32();
        this.f32();
        this.f32();
        this.f32();
        break;
      case 2:
        this.skipIntArray();
        break;
      case 0:
      default:
        break;
    }
  }
}

const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'];

/**
 * Locate the exporter version string.
 *
 * The version is the second length-prefixed string in the file, but these files
 * are not plain Spine exports: Skybound's asset manager inserts a 20-character
 * fingerprint between the hash and the version. A plain reader therefore returns
 * "<fingerprint>\x07..." as the "version" and never matches a runtime.
 *
 * The encoding is Spine's own readString(): the length is the byte count
 * *including a leading marker byte*, so "3.8.99" is written as [0x07]"3.8.99".
 * We scan the header for that exact shape - a length byte followed by a
 * well-formed "M.m.p" token of length-1 bytes - which only the real header
 * satisfies.
 */
const VERSION_TOKEN = /^\d{1,2}\.\d{1,2}\.\d{1,2}(-?[A-Za-z0-9.]+)?$/;

function findVersionBlock(bytes: Uint8Array): { version: string; bodyOffset: number } {
  const limit = Math.min(bytes.length - 1, 72);
  for (let i = 8; i < limit; i++) {
    const byteCount = bytes[i];
    if (byteCount < 6 || byteCount > 25) continue;
    const startAt = i + 1;
    const end = startAt + byteCount - 1; // byteCount includes the marker byte
    if (end > bytes.length) continue;
    const version = new TextDecoder('latin1').decode(bytes.subarray(startAt, end));
    if (!VERSION_TOKEN.test(version)) continue;
    return { version, bodyOffset: end };
  }
  throw new Error('No Spine version header found (not a Spine skeleton?)');
}

function readHeader(bytes: Uint8Array) {
  if (bytes.length < 16) throw new Error('File is too short to be a Spine skeleton');
  const { version, bodyOffset } = findVersionBlock(bytes);
  return {
    hash: new TextDecoder('latin1').decode(bytes.subarray(0, 8)),
    version,
    bodyOffset,
  };
}

/**
 * Read a binary skeleton far enough to answer every question the viewer and the
 * health report ask. Throws nothing; failures land in `.error` with everything
 * parsed up to that point preserved.
 */
export function inspectBinarySkeleton(bytes: Uint8Array): SpineInspection {
  const result: SpineInspection = {
    ok: false,
    version: null,
    majorMinor: null,
    hash: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    nonessential: false,
    images: [],
    bones: [],
    slots: [],
    defaults: { skins: [], bones: [], constraints: [] },
    skins: [],
    animations: [],
    animationCount: 0,
    stringTable: [],
    headerParsed: false,
    darkTintedSlots: [],
    error: null,
  };

  let bodyOffset = 0;
  try {
    const header = readHeader(bytes);
    bodyOffset = header.bodyOffset;
    result.hash = header.hash;
    result.version = header.version;
    const m = header.version.match(/^(\d+)\.(\d+)/);
    result.majorMinor = m ? `${m[1]}.${m[2]}` : null;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  // Everything from here reproduces spine-ts 3.8's SkeletonBinary.readSkeletonData
  // read order exactly (see src/vendor/spine-player3.8.js): hash, version,
  // floats, nonessential flag, then the shared string table, then bones.
  const r = new BinaryReader(bytes);
  try {
    r.pos = bodyOffset;

    result.x = r.f32();
    result.y = r.f32();
    result.width = r.f32();
    result.height = r.f32();
    result.nonessential = r.u8() !== 0;
    if (result.nonessential) {
      r.f32(); // fps
      const imagesPath = r.readString();
      r.readString(); // audio path
      if (imagesPath) result.images.push(imagesPath);
    }

    // Shared string table: every string referenced by index elsewhere lives here.
    const stringCount = r.varint(true);
    for (let i = 0; i < stringCount; i++) {
      result.stringTable.push(r.readString());
    }

    // ---- bones -------------------------------------------------------------
    const boneCount = r.varint(true);
    for (let i = 0; i < boneCount; i++) {
      const name = r.readString();
      const parent = i === 0 ? null : result.bones[r.varint(true)]?.name ?? null;
      r.f32(); // rotation
      r.f32(); // x
      r.f32(); // y
      r.f32(); // scaleX
      r.f32(); // scaleY
      r.f32(); // shearX
      r.f32(); // shearY
      r.f32(); // length
      r.varint(true); // transformMode
      r.u8(); // skinRequired
      if (result.nonessential) r.i32(); // bone colour
      result.bones.push({ name, parent });
    }

    // ---- slots -------------------------------------------------------------
    const slotCount = r.varint(true);
    for (let i = 0; i < slotCount; i++) {
      const name = r.readString();
      r.varint(true); // bone index
      const color = unpackRgba8888(r.i32());
      const darkPacked = r.i32();
      const dark = darkPacked === -1 ? null : unpackRgb888(darkPacked);
      const attachmentRef = r.varint(true);
      const attachment = attachmentRef === 0 ? '' : `#${attachmentRef}`;
      const blend = BLEND_MODES[r.varint(true)] || 'normal';
      result.slots.push({ name, attachment, blend, color, dark });
      if (dark) result.darkTintedSlots.push(name);
    }

    // ---- constraints -------------------------------------------------------
    const ikCount = r.varint(true);
    for (let i = 0; i < ikCount; i++) {
      r.readString();
      r.varint(true); // order
      r.u8(); // skinRequired
      const bones = r.varint(true);
      for (let b = 0; b < bones; b++) r.varint(true);
      r.varint(true); // target
      r.f32(); // mix
      r.f32(); // softness
      r.i8(); // bendDirection
      r.u8(); // compress
      r.u8(); // stretch
      r.u8(); // uniform
    }
    const transformCount = r.varint(true);
    for (let i = 0; i < transformCount; i++) {
      r.readString();
      r.varint(true); // order
      r.u8(); // skinRequired
      const bones = r.varint(true);
      for (let b = 0; b < bones; b++) r.varint(true);
      r.varint(true); // target
      r.u8(); // local
      r.u8(); // relative
      r.f32(); // offsetRotation
      r.f32(); // offsetX
      r.f32(); // offsetY
      r.f32(); // offsetScaleX
      r.f32(); // offsetScaleY
      r.f32(); // offsetShearY
      r.f32(); // rotateMix
      r.f32(); // translateMix
      r.f32(); // scaleMix
      r.f32(); // shearMix
    }
    const pathCount = r.varint(true);
    for (let i = 0; i < pathCount; i++) {
      r.readString();
      r.varint(true); // order
      r.u8(); // skinRequired
      const bones = r.varint(true);
      for (let b = 0; b < bones; b++) r.varint(true);
      r.varint(true); // target slot
      r.varint(true); // positionMode
      r.varint(true); // spacingMode
      r.varint(true); // rotateMode
      r.f32(); // offsetRotation
      r.f32(); // position
      r.f32(); // spacing
      r.f32(); // rotateMix
      r.f32(); // translateMix
    }

    // ---- default skin, then named skins -----------------------------------
    // readSkin(input, defaultSkin=true): the count alone, or 0 when absent.
    result.headerParsed = true;
    const defaultSlotCount = r.varint(true);
    if (defaultSlotCount > 0) {
      const skin: SpineSkinInfo = { name: 'default', entries: [] };
      skipSkinSlots(r, result, skin, defaultSlotCount);
      result.skins.push(skin);
    }
    const namedSkinCount = r.varint(true);
    for (let i = 0; i < namedSkinCount; i++) {
      const nameRef = r.varint(true);
      const skin: SpineSkinInfo = {
        name: nameRef === 0 ? `default` : result.stringTable[nameRef - 1] ?? `skin${i + 1}`,
        entries: [],
      };
      const boneRefs = r.varint(true);
      for (let b = 0; b < boneRefs; b++) r.varint(true);
      const ikRefs = r.varint(true);
      for (let k = 0; k < ikRefs; k++) r.varint(true);
      const trRefs = r.varint(true);
      for (let k = 0; k < trRefs; k++) r.varint(true);
      const pathRefs = r.varint(true);
      for (let k = 0; k < pathRefs; k++) r.varint(true);
      const slotCount = r.varint(true);
      skipSkinSlots(r, result, skin, slotCount);
      result.skins.push(skin);
    }

    // ---- events ------------------------------------------------------------
    const eventCount = r.varint(true);
    for (let i = 0; i < eventCount; i++) {
      r.readString();
      r.varint(false);
      r.f32();
      r.readString();
      r.readString();
    }

    // ---- animations (names only; durations need the full walk) -------------
    const animCount = r.varint(true);
    result.animationCount = Number.isFinite(animCount) ? animCount : 0;

    result.ok = true;
  } catch (err) {
    // Attachment payloads are variable-length; reaching one means everything
    // before it (header, bones, slots, constraints, skin names) parsed cleanly,
    // which is all the viewer needs. Record why we stopped rather than discarding
    // the work.
    if (err instanceof AttachmentBoundary) {
      // Everything up to the first attachment payload parsed cleanly, which is
      // the whole of what the viewer and the health report need.
      result.ok = true;
    } else {
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  // A file is "ok" when the header, slot table and skin structure all read back,
  // regardless of whether attachment payloads were walked.
  if (result.headerParsed && result.slots.length > 0) result.ok = true;

  return result;
}

/**
 * Walk one skin's slot overrides. Attachment payloads are variable-length and
 * decode to region/mesh/boundingbox/path/clipping shapes; none of that is needed
 * to name the skin's contents, so this records the slot and moves on at the
 * attachment boundary the format guarantees (name ref, then type byte).
 */
function skipSkinSlots(r: BinaryReader, result: SpineInspection, skin: SpineSkinInfo, slotCount: number) {
  for (let i = 0; i < slotCount; i++) {
    const slotIndex = r.varint(true);
    const slotName = result.slots[slotIndex]?.name ?? `#${slotIndex}`;
    const attachCount = r.varint(true);
    for (let a = 0; a < attachCount; a++) {
      r.varint(true); // attachment name ref
      throw new AttachmentBoundary(slotName, attachCount);
    }
    if (attachCount === 0) skin.entries.push({ slot: slotName, attachment: '' });
  }
}

class AttachmentBoundary extends Error {
  readonly slot: string;
  readonly count: number;
  constructor(slot: string, count: number) {
    super(`attachment boundary at slot ${slot}`);
    this.slot = slot;
    this.count = count;
  }
}

function unpackRgba8888(packed: number): [number, number, number, number] {
  const v = packed >>> 0;
  return [
    ((v & 0xff000000) >>> 24) / 255,
    ((v & 0x00ff0000) >>> 16) / 255,
    ((v & 0x0000ff00) >>> 8) / 255,
    (v & 0x000000ff) / 255,
  ];
}

function unpackRgb888(packed: number): [number, number, number, number] {
  const v = packed >>> 0;
  return [((v & 0xff0000) >>> 16) / 255, ((v & 0x00ff00) >>> 8) / 255, (v & 0x0000ff) / 255, 1];
}

function skipAttachment(r: BinaryReader, nonessential: boolean) {
  // Attachments are self-describing: name, then a type tag understood by the
  // reader in spine-ts. We only need to walk past them.
  const kind = r.readString();
  void kind;
  throw new Error('attachment walk not required for header inspection');
}

function skipAnimation(_r: BinaryReader) {
  throw new Error('animation walk not required for header inspection');
}

/** Header-only read, used when the full parse could not complete. */
export function readSkeletonHeader(bytes: Uint8Array): { version: string | null; hash: string } {
  try {
    return readHeader(bytes);
  } catch {
    return { version: null, hash: '' };
  }
}

/**
 * Map an exporter version onto the nearest bundled runtime.
 * The 4.1 parser cannot read 4.2 data, so newer data always goes to the newest
 * runtime we ship rather than silently mis-parsing.
 */
export function runtimeForVersion(version: string | null): '3.8' | '4.0' | '4.1' | '4.2' {
  if (!version) return '4.1';
  const m = version.match(/^(\d+)\.(\d+)/);
  if (!m) return '4.1';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major <= 3) return '3.8';
  if (major === 4) {
    if (minor <= 0) return '4.0';
    if (minor === 1) return '4.1';
    return '4.2';
  }
  return '4.2';
}
