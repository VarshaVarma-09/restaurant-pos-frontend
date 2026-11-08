import { answerAssistantQuestion } from '../services/assistantService.js';
import { randomUUID } from 'node:crypto';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 12;

export function createAssistantController({ answer = answerAssistantQuestion } = {}) {
  return async function assistantChat(req, res) {
    const requestId = randomUUID();
    const startedAt = performance.now();
    console.info('[assistant][controller] request.received', {
      requestId,
      method: req.method,
      path: '/api/assistant/chat'
    });

    try {
      const message = req.body?.message;
      if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ message: `Message must contain 1 to ${MAX_MESSAGE_LENGTH} characters.` });
      }
      const history = req.body?.history ?? [];
      if (!Array.isArray(history) || history.length > MAX_HISTORY_MESSAGES || history.some(item => (
        !item || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string'
        || !item.text.trim() || item.text.length > MAX_MESSAGE_LENGTH
      ))) {
        return res.status(400).json({ message: `Conversation history must contain at most ${MAX_HISTORY_MESSAGES} valid messages.` });
      }

      const response = await answer(message.trim(), { requestId, history });
      if (typeof response !== 'string' || !response.trim()) {
        return res.status(502).json({ message: 'The assistant returned an empty response. Please try again.' });
      }
      return res.json({ response: response.trim() });
    } catch (error) {
      console.error('[assistant][controller] processing.failed', {
        requestId,
        errorName: error?.name || 'Error'
      });
      return res.status(502).json({ message: 'The assistant is temporarily unavailable. Please try again.' });
    } finally {
      console.info('[assistant][controller] request.finished', {
        requestId,
        status: res.statusCode,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    }
  };
}

export default createAssistantController();
