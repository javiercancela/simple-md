import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "simple-md",
    icon: "assets/icon",
    appBundleId: "com.javiercancela.simplemd",
    appCategoryType: "public.app-category.productivity",
    win32metadata: {
      CompanyName: "Javier Cancela",
      FileDescription: "Simple MD",
      ProductName: "Simple MD",
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: {
        license: "UNLICENSED",
      },
    }),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    generateAssets: async () => {
      execFileSync(process.execPath, ["scripts/icons.mjs"], {
        cwd: rootDir,
        stdio: "inherit",
      });
    },
  },
};

export default config;
