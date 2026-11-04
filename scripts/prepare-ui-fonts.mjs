import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const output = join(root, "ui", ".ibeji-public");

const fonts = [
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-sans-latin-ext-400-normal.woff2",
  "ibm-plex-sans-latin-ext-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-ext-400-normal.woff2",
];

const notices = `Ibeji includes locally bundled fonts.

IBM Plex Sans
Copyright 2019 IBM Corp. All rights reserved.
Licensed under the SIL Open Font License, Version 1.1.

IBM Plex Mono
Copyright 2017 IBM Corp. All rights reserved.
Licensed under the SIL Open Font License, Version 1.1.

The full licence texts are in LICENSE-IBM-Plex-Sans.txt and LICENSE-IBM-Plex-Mono.txt.
`;

rmSync(output, { recursive: true, force: true });
const fontOutput = join(output, "assets", "fonts");
mkdirSync(fontOutput, { recursive: true });

for (const font of fonts) {
  const packageName = font.startsWith("ibm-plex-sans")
    ? "@fontsource/ibm-plex-sans"
    : "@fontsource/ibm-plex-mono";
  copyFileSync(join(root, "node_modules", packageName, "files", font), join(fontOutput, font));
}

copyFileSync(
  join(root, "node_modules", "@fontsource/ibm-plex-sans", "LICENSE"),
  join(fontOutput, "LICENSE-IBM-Plex-Sans.txt"),
);
copyFileSync(
  join(root, "node_modules", "@fontsource/ibm-plex-mono", "LICENSE"),
  join(fontOutput, "LICENSE-IBM-Plex-Mono.txt"),
);
writeFileSync(join(output, "THIRD-PARTY-NOTICES.txt"), notices);
