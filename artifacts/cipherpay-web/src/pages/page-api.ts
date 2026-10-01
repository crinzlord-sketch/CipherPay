export type ApiOptions = { method?: string; body?: unknown };

const apiOrigin = (import.meta.env.VITE_API_URL ?? 'https://cipherpay-api.onrender.com').trim().replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return apiOrigin ? `${apiOrigin}${path}` : path;
}

function fallbackApiError(status: number): string {
  if (status === 401) return 'Please sign in again to continue.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'We could not find what you requested.';
  if (status === 409) return 'That request conflicts with the current status. Please try again.';
  if (status === 422) return 'Please check the information and try again.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'The service is temporarily unavailable. Please try again shortly.';
  if (status >= 400) return 'We could not complete that request. Please check your details and try again.';
  return 'The request could not be completed. Please try again.';
}

export function userFacingApiError(payload: unknown, status: number): string {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const message = [body.error, body.message, body.detail, body.error_description]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim();
  if (!message || /\bHTTP\s+\d{3}\b/i.test(message) || /^(bad request|request failed|error|internal server error|unauthorized|forbidden|not found|conflict|unprocessable entity)$/i.test(message)) {
    return fallbackApiError(status);
  }
  return message;
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('cipherpay_token') : null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = typeof window !== 'undefined' ? window.setTimeout(() => controller?.abort(), 15000) : null;
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      signal: controller?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The server took too long to respond. Please try again.');
    }
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(userFacingApiError(payload, response.status));
  return payload as T;
}

export function formatWhen(value?: string | null) {
  if (!value) return 'Just now';
  return new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

export function initials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || 'CP';
}