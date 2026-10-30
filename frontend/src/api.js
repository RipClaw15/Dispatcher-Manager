let csrf = "";
export const driverChoiceLabel = (driver) =>
  `${driver.full_name} · ${driver.citizenship_label || driver.citizenship || "Citizenship not recorded"}`;
const pending = [];
let activeRequests = 0;

// Independent reads stay parallel without overwhelming the local WSGI server's
// connection backlog when StrictMode or a shared-view refresh starts many reads.
function schedule(request) {
  return new Promise((resolve, reject) => {
    pending.push({ request, resolve, reject });
    drain();
  });
}

function drain() {
  while (activeRequests < 4 && pending.length) {
    const job = pending.shift();
    activeRequests += 1;
    Promise.resolve()
      .then(job.request)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeRequests -= 1;
        drain();
      });
  }
}

export class ApiError extends Error {
  constructor(status, data) {
    const flatten = (value) =>
      typeof value === "string"
        ? value
        : Array.isArray(value)
          ? value.map(flatten).join(" ")
          : Object.entries(value || {})
              .map(
                ([key, val]) =>
                  `${key === "detail" ? "" : `${key}: `}${flatten(val)}`,
              )
              .join(" ");
    super(flatten(data) || `Request failed (${status}).`);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  if (method !== "GET" && !csrf) await bootstrapCsrf();
  const headers = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRFToken"] = csrf;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  return schedule(async () => {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      signal,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    const data = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    if (!response.ok) throw new ApiError(response.status, data);
    if (data.csrfToken) csrf = data.csrfToken;
    return data;
  });
}

export async function bootstrapCsrf() {
  const response = await fetch("/api/auth/csrf/", {
    credentials: "same-origin",
  });
  const data = await response.json();
  csrf = data.csrfToken;
}

export async function list(resource, params = {}, signal) {
  const query = new URLSearchParams(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
  return api(`/api/${resource}/?${query}`, { signal });
}

export async function all(resource, params = {}) {
  let page = await list(resource, params);
  const result = [...page.results];
  while (page.next) {
    const url = new URL(page.next);
    page = await api(url.pathname + url.search);
    result.push(...page.results);
  }
  return result;
}

export const command = (resource, record, action, values = {}) =>
  api(`/api/${resource}/${record.id}/command/`, {
    method: "POST",
    body: { version: record.version, action, ...values },
  });
export const money = (value) =>
  value === null || value === undefined
    ? "Not yet known"
    : new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: "EUR",
      }).format(Number(value));
export const label = (record) =>
  record?.reference ||
  record?.name ||
  record?.full_name ||
  record?.registration ||
  record?.title ||
  `${human(record?.kind || "Record")}: ${record?.location_name || record?.city || record?.postal_code || record?.location || record?.id || ""}`;
export const human = (value) =>
  String(value ?? "")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
