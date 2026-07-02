export type ConsoleFetchResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  networkError?: boolean;
};

function loginUrl(reason?: string) {
  const next = `${window.location.pathname}${window.location.search}`;
  const url = new URL("/login", window.location.origin);
  if (reason) {
    url.searchParams.set("reason", reason);
  } else {
    url.searchParams.set("next", next);
  }
  return url.toString();
}

export function redirectToLoginForAuthError(result: Pick<ConsoleFetchResult<unknown>, "status" | "error">) {
  if (typeof window === "undefined") {
    return false;
  }
  if (result.status === 401) {
    window.location.assign(loginUrl());
    return true;
  }
  if (result.status === 503 && result.error?.includes("CONSOLE_PASSWORD")) {
    window.location.assign(loginUrl("not_configured"));
    return true;
  }
  return false;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<ConsoleFetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: init?.credentials ?? "same-origin",
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "Network request failed",
      networkError: true,
    };
  }

  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  }

  try {
    const data = JSON.parse(text) as T & { error?: string };
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : data.error ?? `HTTP ${response.status}`,
    };
  } catch {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: `Invalid JSON response from ${response.url}`,
    };
  }
}
