import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import png2icons from "png2icons";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#1f6f68"/>
  <rect x="232" y="168" width="560" height="688" rx="40" fill="#f7f3ea"/>
  <path d="M632 168h120c22 0 40 18 40 40v112H672c-22 0-40-18-40-40V168z" fill="#e4dccb"/>
  <path d="M672 168v112c0 22 18 40 40 40h80L672 168z" fill="#d3c7b2"/>
  <rect x="312" y="392" width="250" height="36" rx="18" fill="#1f6f68"/>
  <rect x="312" y="464" width="392" height="20" rx="10" fill="#ddd4c4"/>
  <rect x="312" y="508" width="340" height="20" rx="10" fill="#ddd4c4"/>
  <rect x="312" y="552" width="368" height="20" rx="10" fill="#ddd4c4"/>
  <g fill="#1f6f68">
    <rect x="336" y="640" width="28" height="132" rx="8"/>
    <rect x="404" y="640" width="28" height="132" rx="8"/>
    <rect x="308" y="676" width="156" height="26" rx="8"/>
    <rect x="308" y="730" width="156" height="26" rx="8"/>
  </g>
</svg>
`;

fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, "icon.svg"), svg);

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1024 },
  font: { loadSystemFonts: false },
  shapeRendering: 2,
})
  .render()
  .asPng();

fs.writeFileSync(path.join(assets, "icon.png"), png);
const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false, true);
if (!icns || !ico) throw new Error("Icon generation failed");
fs.writeFileSync(path.join(assets, "icon.icns"), icns);
fs.writeFileSync(path.join(assets, "icon.ico"), ico);
