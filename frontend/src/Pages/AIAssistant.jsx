import { useRef, useState } from 'react';
import { apiRequest } from '../api';
import { useAuth } from '../Context/useAuth';

const EXAMPLE_QUESTIONS = [
  'Which menu items are unavailable?',
  'What is the price of Paneer Butter Masala?',
  'Show active orders for table 4.',
  'Which tables are available right now?',
  'Has order ABC123 been paid?',
  'What payment methods can we accept?',
  'How much revenue did we collect today?',
  'Give me the sales summary and top-selling items.'
];

function newMessageId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function AIAssistant() {
  const { can } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pendingRequest = useRef(false);

  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || pendingRequest.current || !can('assistant:use')) return;

    console.info('[assistant][frontend] submit', { messageLength: message.length });
    pendingRequest.current = true;
    setLoading(true);
    setError('');
    setMessages(current => [...current, { id: newMessageId(), role: 'user', text: message }]);
    setDraft('');

    try {
      const history = messages.slice(-12).map(({ role, text }) => ({ role, text }));
      const result = await apiRequest('/assistant/chat', { method: 'POST', body: { message, history }, timeoutMs: 45_000 });
      if (typeof result.response !== 'string' || !result.response.trim()) {
        throw new Error('The assistant returned an empty response. Please try again.');
      }
      setMessages(current => [...current, { id: newMessageId(), role: 'assistant', text: result.response.trim() }]);
    } catch (requestError) {
      console.warn('[assistant][frontend] submit.failed', {
        errorName: requestError?.name || 'Error',
        timeout: requestError?.code === 'REQUEST_TIMEOUT'
      });
      setError(requestError.message || 'The assistant could not respond. Please try again.');
    } finally {
      pendingRequest.current = false;
      setLoading(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="page ai-assistant-page">
      <header className="ai-assistant-heading">
        <div>
          <p className="ai-assistant-eyebrow">Restaurant insights</p>
          <h1>AI Assistant</h1>
          <p>Ask about your menu, orders, tables, bills, payments, or sales.</p>
        </div>
        <span className="ai-assistant-access">Owner &amp; Manager</span>
      </header>

      <section className="ai-assistant-card" aria-label="Restaurant analytics assistant">
        {messages.length === 0 ? (
          <div className="ai-assistant-empty">
            <span className="ai-assistant-mark" aria-hidden="true">✦</span>
            <h2>What would you like to know?</h2>
            <p>Answers are based on your restaurant’s stored sales and order data.</p>
            <div className="ai-assistant-examples">
              {EXAMPLE_QUESTIONS.map(question => (
                <button key={question} type="button" disabled={loading} onClick={() => sendMessage(question)}>
                  {question}<span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ai-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
            {messages.map(item => (
              <article className={`ai-message ai-message-${item.role}`} key={item.id}>
                <span className="ai-message-label">{item.role === 'user' ? 'You' : 'Assistant'}</span>
                <p>{item.text}</p>
              </article>
            ))}
            {loading && <p className="ai-assistant-thinking" role="status">Checking restaurant data…</p>}
          </div>
        )}

        {error && <p className="ai-assistant-error" role="alert">{error}</p>}

        <form className="ai-assistant-composer" onSubmit={event => { event.preventDefault(); sendMessage(); }}>
          <label className="sr-only" htmlFor="assistant-message">Ask the restaurant assistant</label>
          <textarea
            id="assistant-message"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about today’s revenue or your orders…"
            maxLength={2000}
            rows={2}
            disabled={loading}
          />
          <div className="ai-assistant-composer-footer">
            <span>Enter to send · Shift+Enter for a new line</span>
            <button type="submit" disabled={loading || !draft.trim()}>
              {loading ? 'Sending…' : 'Send'}
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </form>
      </section>
      <p className="ai-assistant-footnote">The assistant provides read-only analytics and does not change restaurant records.</p>
    </main>
  );
}

export default AIAssistant;
