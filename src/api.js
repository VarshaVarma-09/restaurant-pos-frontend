const API_URL = import.meta.env.VITE_API_URL || '/api';
export function getToken() { try { return globalThis.localStorage?.getItem('restaurantPosToken') || ''; } catch { return ''; } }
export async function apiRequest(path, { method = 'GET', body, token = getToken(), headers = {}, timeoutMs = 0 } = {}) {
    let response;
    const isAssistantRequest = path === '/assistant/chat';
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const elapsedMs = () => Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt);

    if (isAssistantRequest) {
        console.info('[assistant][frontend] api.request.start', { method, path, timeoutMs });
    }

    try {
        response = await fetch(`${API_URL}${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(controller ? { signal: controller.signal } : {}) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.message || `Request failed (${response.status}).`);
            error.status = response.status;
            error.apiMethod = method;
            error.apiPath = path;
            throw error;
        }
        if (isAssistantRequest) {
            console.info('[assistant][frontend] api.request.success', { method, path, status: response.status, elapsedMs: elapsedMs() });
        }
        return data;
    } catch (error) {
        const timedOut = controller?.signal.aborted || error?.name === 'AbortError';
        const requestError = timedOut ? new Error('The assistant request timed out. Please try again.') : error;
        if (timedOut) requestError.code = 'REQUEST_TIMEOUT';
        requestError.apiMethod = method;
        requestError.apiPath = path;
        if (isAssistantRequest) {
            console.warn('[assistant][frontend] api.request.failed', {
                method,
                path,
                status: requestError.status,
                errorName: requestError.name || 'Error',
                timeout: Boolean(timedOut),
                elapsedMs: elapsedMs()
            });
        }
        throw requestError;
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}
