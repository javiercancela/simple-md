import type { MdApi } from "./shared/api";

declare global {
  interface Window {
    md: MdApi;
  }
}

export {};
