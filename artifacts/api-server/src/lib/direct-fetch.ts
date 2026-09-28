import { Agent, fetch as undiciFetch } from "undici";

const _agent = new Agent();

export const directFetch: typeof globalThis.fetch = (input, init?) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as any),
    dispatcher: _agent,
  }) as unknown as Promise<Response>;
