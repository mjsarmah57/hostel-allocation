import axios from 'axios';

// ---------------------------------------------------------------------
// Token storage decision:
//  - Access token: kept in MEMORY only (this module variable). An XSS payload
//    cannot read it from localStorage because it is never written there.
//  - Refresh token: httpOnly cookie set by the API, invisible to JavaScript.
//    That cookie is why every request uses withCredentials: true.
//  Trade-off: a page reload loses the access token, so the app calls
//  /auth/refresh once on startup to get a new one.
// ---------------------------------------------------------------------
let accessToken = null;
export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;

let onSessionExpired = () => {};
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// ---------------------------------------------------------------------
// Single-flight refresh: if five requests fail with 401 at once, only ONE
// /auth/refresh call is made. The other four wait on the same promise and
// then retry. Firing five refreshes would trip the server's reuse detection
// (each refresh token is single-use) and log the user out.
// ---------------------------------------------------------------------
let refreshPromise = null;

export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${import.meta.env.VITE_API_URL}/auth/refresh`, null, { withCredentials: true })
      .then((res) => {
        setAccessToken(res.data.accessToken);
        return res.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/');

    if (status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true; // retry at most once: no infinite loop
      try {
        await refreshAccessToken();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (refreshError) {
        setAccessToken(null);
        onSessionExpired(); // clean logout instead of a retry loop
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

// Every API error has the shape { error: { code, message, details, requestId } }.
export function errorMessage(err) {
  const e = err?.response?.data?.error;
  if (e) {
    const details = Array.isArray(e.details) ? ` (${e.details.map((d) => d.message || JSON.stringify(d)).join('; ')})` : '';
    return `${e.message}${details}`;
  }
  if (err?.code === 'ECONNABORTED') return 'The server took too long to respond';
  if (!err?.response) return 'Cannot reach the server. Check your connection.';
  return 'Something went wrong';
}
