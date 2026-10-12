// Re-encodes every texture in a GLB as KTX2 (Basis ETC1S), optionally scaled down for mobile.
// KTX2 stays block-compressed on the GPU (~4–8x smaller than the decoded WebP), which is what keeps iOS Safari under its memory limit.
//
//   node tools/compress-textures.mjs assets/model/night.glb assets/model/night.ktx2.glb
//   node tools/compress-textures.mjs assets/model/night.glb assets/model/night.mobile.ktx2.glb --scale 0.5
//
// Always run it on the WebP GLBs (night.glb / day.glb), not on its own output: KTX2 textures can't be resized again.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';

const args = process.argv.slice(2);
const [inp, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback; };
const scale = flag('scale', 1);
const quality = flag('quality', 230); // ETC1S quality 1–255; baked lighting bands below ~200
if (!inp || !out) { console.error('usage: compress-textures.mjs <in.glb> <out.glb> [--scale 0.5] [--quality 230]'); process.exit(1); }

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
await doc.transform(dedup(), prune({ keepExtras: true }));

// Decode to raw RGBA for the Basis encoder, scaling on the way (sizes stay multiples of 4 for block compression).
const imageDecoder = async (buffer) => {
  let img = sharp(buffer);
  if (scale !== 1) {
    const { width, height } = await img.metadata();
    const fit = (v) => Math.max(4, Math.round((v * scale) / 4) * 4);
    img = img.resize(fit(width), fit(height), { kernel: 'lanczos3' });
  }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

const textures = doc.getRoot().listTextures();
let before = 0, after = 0, n = 0;
// One at a time: the WASM encoder is single-threaded, and this keeps memory flat on the 200+ texture scenes.
for (const texture of textures) {
  if (texture.getMimeType() === 'image/ktx2') continue;
  const image = texture.getImage();
  if (!image) continue;
  const ktx2 = await encodeToKTX2(image, { isUASTC: false, qualityLevel: quality, generateMipmap: true, isSetKTX2SRGBTransferFunc: true, imageDecoder });
  before += image.byteLength; after += ktx2.byteLength;
  texture.setImage(ktx2).setMimeType('image/ktx2');
  if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.\w+$/, '.ktx2'));
  process.stdout.write(`\r${++n}/${textures.length} textures`);
}
doc.createExtension(KHRTextureBasisu).setRequired(true);
await io.write(out, doc);
console.log(`\n${inp} → ${out}  textures ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB (scale ${scale}, quality ${quality})`);
