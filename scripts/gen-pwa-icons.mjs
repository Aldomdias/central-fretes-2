import sharp from "sharp";
import { mkdirSync } from "fs";

const src = "public/favicon.png";
mkdirSync("public/icons", { recursive: true });

const sizes = [
  { file: "public/icons/icon-192.png", size: 192, pad: 0.12 },
  { file: "public/icons/icon-512.png", size: 512, pad: 0.12 },
  { file: "public/icons/maskable-512.png", size: 512, pad: 0.2 },
  { file: "public/apple-touch-icon.png", size: 180, pad: 0.12 },
];

for (const { file, size, pad } of sizes) {
  const inner = Math.round(size * (1 - pad * 2));
  await sharp(src)
    .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .extend({
      top: Math.round((size - inner) / 2),
      bottom: Math.round((size - inner) / 2),
      left: Math.round((size - inner) / 2),
      right: Math.round((size - inner) / 2),
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .resize(size, size)
    .png()
    .toFile(file);
  console.log("gerado:", file);
}
