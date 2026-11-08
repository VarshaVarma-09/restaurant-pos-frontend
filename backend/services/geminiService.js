import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
const ai = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta', retryOptions: { attempts: 1 } } }) : null;

function collectUserPrompts(contents) {
  if (typeof contents === 'string') return [contents];
  if (!Array.isArray(contents)) return [];
  return contents.flatMap(content => content?.role === 'user' && Array.isArray(content.parts)
    ? content.parts.filter(part => typeof part?.text === 'string').map(part => part.text)
    : []);
}

function safeDiagnosticText(value, prompts) {
  if (typeof value !== 'string') return undefined;
  let safeValue = value;
  for (const prompt of prompts) {
    if (!prompt) continue;
    safeValue = safeValue.replaceAll(prompt, '[REDACTED_PROMPT]');
    const escapedPrompt = JSON.stringify(prompt).slice(1, -1);
    if (escapedPrompt && escapedPrompt !== prompt) safeValue = safeValue.replaceAll(escapedPrompt, '[REDACTED_PROMPT]');
  }
  if (apiKey) safeValue = safeValue.replaceAll(apiKey, '[REDACTED_API_KEY]');
  return safeValue
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/(?:request\s+)?headers?\s*[:=]\s*\{[^}]*\}/gi, '[REDACTED_REQUEST_HEADERS]')
    .replace(/(["']?(?:x-goog-api-key|authorization|cookie)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[REDACTED]');
}

function readProviderDiagnostics(error, contents) {
  let payload;
  try {
    payload = JSON.parse(error?.message || '');
  } catch {
    payload = null;
  }

  const providerError = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
  const details = Array.isArray(providerError?.details) ? providerError.details : [];
  const quotaDetail = details.find(detail => /QuotaFailure$/.test(String(detail?.['@type'] || detail?.type || '')));
  const retryDetail = details.find(detail => /RetryInfo$/.test(String(detail?.['@type'] || detail?.type || '')));
  const quotaFailure = providerError?.quotaFailure || quotaDetail;
  const prompts = collectUserPrompts(contents);
  const violations = Array.isArray(quotaFailure?.violations)
    ? quotaFailure.violations.map(violation => ({
      ...(safeDiagnosticText(violation?.subject, prompts) ? { subject: safeDiagnosticText(violation.subject, prompts) } : {}),
      ...(safeDiagnosticText(violation?.description, prompts) ? { description: safeDiagnosticText(violation.description, prompts) } : {}),
      ...(safeDiagnosticText(violation?.quotaMetric, prompts) ? { quotaMetric: safeDiagnosticText(violation.quotaMetric, prompts) } : {}),
      ...(safeDiagnosticText(violation?.quotaId, prompts) ? { quotaId: safeDiagnosticText(violation.quotaId, prompts) } : {})
    }))
    : [];
  const retryDelay = retryDetail?.retryDelay ?? providerError?.retryDelay;

  return {
    httpStatus: Number.isFinite(error?.status) ? error.status : undefined,
    errorMessage: safeDiagnosticText(providerError?.message || error?.message, prompts),
    errorStatus: safeDiagnosticText(providerError?.status, prompts),
    errorCode: Number.isFinite(providerError?.code) || typeof providerError?.code === 'string'
      ? safeDiagnosticText(String(providerError.code), prompts)
      : undefined,
    quotaFailure: quotaFailure ? { ...(violations.length ? { violations } : {}) } : undefined,
    retryDelay: safeDiagnosticText(typeof retryDelay === 'string' ? retryDelay : undefined, prompts)
  };
}

async function requestGemini(contents, config, requestContext = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  if (!model) throw new Error('GEMINI_MODEL is not configured.');

  const startedAt = performance.now();
  const logContext = {
    ...(requestContext.requestId ? { requestId: requestContext.requestId } : {}),
    ...(Number.isInteger(requestContext.round) ? { round: requestContext.round } : {})
  };
  console.info('[assistant][gemini] request.start', logContext);

  try {
    const response = await ai.models.generateContent({ model, contents, ...(config ? { config } : {}) });
    console.info('[assistant][gemini] request.complete', {
      ...logContext,
      functionCallCount: Array.isArray(response?.functionCalls) ? response.functionCalls.length : undefined,
      hasText: typeof response?.text === 'string' && Boolean(response.text.trim()),
      elapsedMs: Math.round(performance.now() - startedAt)
    });
    return response;
  } catch (error) {
    const providerDiagnostics = readProviderDiagnostics(error, contents);
    const details = [
      Number.isFinite(error?.status) ? `status=${error.status}` : null,
      ['string', 'number'].includes(typeof error?.code) ? `code=${error.code}` : null,
      typeof error?.name === 'string' ? `name=${error.name}` : null
    ].filter(Boolean);
    console.error('[assistant][gemini] request.failed', {
      ...logContext,
      ...providerDiagnostics,
      errorName: error?.name || 'Error',
      elapsedMs: Math.round(performance.now() - startedAt)
    });
    // Deliberately discard the original error to keep provider diagnostics private.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Gemini API request failed${details.length ? ` (${details.join(', ')})` : ''}.`);
  }
}

export async function generateAIResponse(prompt) {
  const response = await requestGemini(prompt);
  return response.text;
}

export async function generateAIResponseWithTools(contents, config, requestContext) {
  return requestGemini(contents, config, requestContext);
}
