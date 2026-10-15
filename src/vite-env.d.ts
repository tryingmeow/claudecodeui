/// <reference types="vite/client" />

/**
 * Installed package version, injected by Vite's `define` at build time.
 * Read it through `APP_VERSION` in `@/shared/constants`, which also covers
 * runners such as `tsx` that do not apply Vite's define replacement.
 */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Comma-separated provider ids the UI offers; see `@/shared/enabledProviders`. */
  readonly VITE_ENABLED_PROVIDERS?: string;
}
