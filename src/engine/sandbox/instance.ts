import { browserFactories, SandboxClient } from './client';

let client: SandboxClient | null = null;

/** Lazily created app-wide sandbox (workers spawn on first use / warm-up). */
export function sandbox(): SandboxClient {
  if (!client) client = new SandboxClient(browserFactories());
  return client;
}
