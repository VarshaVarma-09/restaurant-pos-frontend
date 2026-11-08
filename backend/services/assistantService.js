import {
  getCollectedRevenue,
  getPendingOrders,
  getSalesSummary,
  getTopSellingItems
} from './analyticsService.js';
import {
  getBillForOrder,
  getMenuCategories,
  getOrderDetails,
  getOrderStatusCounts,
  getPaymentsForOrder,
  getSupportedPaymentMethods,
  getTableSummary,
  getTables,
  listOrders,
  searchMenuItems
} from './assistantDataService.js';
import { generateAIResponseWithTools } from './geminiService.js';

const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 8;
const MAX_PENDING_ORDERS = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;

function logAssistantStage(stage, requestId, details = {}) {
  console.info(`[assistant][service] ${stage}`, { ...(requestId ? { requestId } : {}), ...details });
}

function elapsedSince(startedAt) {
  return Math.round(performance.now() - startedAt);
}

const dateProperties = {
  start: { type: 'STRING', description: 'Optional inclusive UTC start date/time in ISO 8601 format.' },
  end: { type: 'STRING', description: 'Optional exclusive UTC end date/time in ISO 8601 format.' }
};

const dateParameters = {
  type: 'OBJECT',
  properties: dateProperties,
  additionalProperties: false
};

const emptyParameters = { type: 'OBJECT', properties: {}, additionalProperties: false };
const orderIdentifierParameters = {
  type: 'OBJECT',
  properties: { orderIdOrNumber: { type: 'STRING', description: 'Exact internal order id or displayed order number.' } },
  required: ['orderIdOrNumber'],
  additionalProperties: false
};
const limitProperty = { type: 'INTEGER', description: 'Maximum results from 1 to 50; defaults to 20.' };

const toolDeclarations = [
  {
    name: 'get_sales_summary',
    description: 'Get collected revenue, tips, completed payment count, non-cancelled order count, and cancelled order count. Omit dates for all-time summary; specify start and end for a date range.',
    parameters: dateParameters
  },
  {
    name: 'get_top_selling_items',
    description: 'Get the highest-selling items from settled bills only, excluding cancelled orders. Returns item name, quantity sold, and item-line revenue. Omit dates for all-time results.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ...dateProperties,
        limit: { type: 'INTEGER', description: 'Optional maximum results, from 1 to 50.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_pending_orders',
    description: 'List currently open or in-progress orders. Results contain no customer personal information.',
    parameters: { type: 'OBJECT', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_collected_revenue',
    description: 'Get collected revenue, tips separately, and completed payment count. Omit dates for all-time totals; specify start and end for a date range.',
    parameters: dateParameters
  },
  {
    name: 'search_menu_items',
    description: 'Read menu item names, descriptions, categories, prices, and available status. Use query for an item name or text, category to filter a category, and availability available/unavailable/all. The MenuItem schema has no separate active field.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Optional name or description text to search.' },
        category: { type: 'STRING', description: 'Optional exact category name.' },
        availability: { type: 'STRING', enum: ['available', 'unavailable', 'all'], description: 'Defaults to available.' },
        limit: limitProperty
      },
      additionalProperties: false
    }
  },
  { name: 'get_menu_categories', description: 'List the categories present on menu items, and indicate whether uncategorized items exist.', parameters: emptyParameters },
  { name: 'get_order_details', description: 'Get one order by exact order id or order number, with safe item details and its associated bill when present. Does not include customer details.', parameters: orderIdentifierParameters },
  {
    name: 'list_orders',
    description: 'List orders with safe order fields. Filter by an exact order status or table id, or set activeOnly for Open and In Progress orders. Order status values are Open, In Progress, Completed, and Cancelled.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: { type: 'STRING', enum: ['Open', 'In Progress', 'Completed', 'Cancelled'] },
        tableId: { type: 'STRING' },
        activeOnly: { type: 'BOOLEAN' },
        limit: limitProperty
      },
      additionalProperties: false
    }
  },
  { name: 'get_order_status_counts', description: 'Count orders by their actual Order status and kitchen tickets by their actual KOT status. Preparing and Ready are KOT states, not Order status values.', parameters: emptyParameters },
  {
    name: 'get_tables',
    description: 'List tables with their stored Available, Occupied, or Reserved status, active flag, capacity, and any associated active dine-in orders. Defaults to active tables only.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tableIdOrName: { type: 'STRING' },
        status: { type: 'STRING', enum: ['Available', 'Occupied', 'Reserved'] },
        activeOnly: { type: 'BOOLEAN' },
        limit: limitProperty
      },
      additionalProperties: false
    }
  },
  { name: 'get_table_summary', description: 'Count active tables by Available, Occupied, and Reserved status, plus inactive table count.', parameters: emptyParameters },
  { name: 'get_bill_for_order', description: 'Get the bill total, completed amounts paid, tips separately, and remaining balance for one order. Revenue is based on completed payment applications; bill totals are not added to payment totals.', parameters: orderIdentifierParameters },
  { name: 'get_payments_for_order', description: 'List safe payment method, applied amount, tip, status, mode, and time for one order. Does not include references, cash details, recorder identity, or other sensitive payment data.', parameters: orderIdentifierParameters },
  { name: 'get_supported_payment_methods', description: 'Return payment methods supported by the Payment model.', parameters: emptyParameters }
];

const supportedNames = new Set(toolDeclarations.map(tool => tool.name));

function validateObjectArgs(args, allowedKeys) {
  if (args === undefined) return {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Tool arguments must be an object.');
  }
  if (Object.keys(args).some(key => !allowedKeys.includes(key))) {
    throw new TypeError('Tool arguments contain unsupported fields.');
  }
  return args;
}

function validateDateArgs(args, allowedKeys = ['start', 'end']) {
  const values = validateObjectArgs(args, allowedKeys);
  for (const key of ['start', 'end']) {
    if (values[key] === undefined) continue;
    const value = values[key];
    const parsedDate = typeof value === 'string' && DATE_PATTERN.test(value) ? new Date(value) : null;
    const datePart = typeof value === 'string' ? value.slice(0, 10) : '';
    const [year, month, day] = datePart.split('-').map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    const hasValidCalendarDate = calendarDate.getUTCFullYear() === year
      && calendarDate.getUTCMonth() === month - 1
      && calendarDate.getUTCDate() === day;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || !hasValidCalendarDate) {
      throw new TypeError(`${key} must be an ISO 8601 date or date-time.`);
    }
  }
  if (values.start && values.end && new Date(values.start) >= new Date(values.end)) {
    throw new RangeError('start must be earlier than end.');
  }
  return Object.fromEntries(['start', 'end'].filter(key => values[key] !== undefined).map(key => [key, values[key]]));
}

function validateLimit(args, defaultValue = 20) {
  const limit = args.limit ?? defaultValue;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError('limit must be an integer from 1 to 50.');
  return limit;
}

function validateOptionalString(args, key, maxLength) {
  const value = args[key];
  if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
    throw new TypeError(`${key} must be a string of at most ${maxLength} characters.`);
  }
  return value;
}

function validateRequiredIdentifier(args) {
  const value = args.orderIdOrNumber;
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new TypeError('orderIdOrNumber must be a non-empty string of at most 120 characters.');
  }
  return { orderIdOrNumber: value.trim() };
}

function validateToolCall(call) {
  if (!call || typeof call.name !== 'string' || !supportedNames.has(call.name)) {
    throw new TypeError('The model requested an unsupported analytics tool.');
  }
  if (call.name === 'get_pending_orders') {
    validateObjectArgs(call.args, []);
    return { ...call, args: {} };
  }
  if (call.name === 'get_top_selling_items') {
    const args = validateDateArgs(call.args, ['start', 'end', 'limit']);
    if (call.args?.limit !== undefined) {
      if (!Number.isSafeInteger(call.args.limit) || call.args.limit < 1 || call.args.limit > 50) {
        throw new RangeError('limit must be an integer from 1 to 50.');
      }
      args.limit = call.args.limit;
    }
    return { ...call, args };
  }
  if (call.name === 'get_sales_summary' || call.name === 'get_collected_revenue') {
    return { ...call, args: validateDateArgs(call.args) };
  }
  if (call.name === 'search_menu_items') {
    const args = validateObjectArgs(call.args, ['query', 'category', 'availability', 'limit']);
    validateOptionalString(args, 'query', 120);
    validateOptionalString(args, 'category', 80);
    if (args.availability !== undefined && !['available', 'unavailable', 'all'].includes(args.availability)) {
      throw new TypeError('availability must be available, unavailable, or all.');
    }
    return { ...call, args: { ...args, limit: validateLimit(args) } };
  }
  if (call.name === 'get_menu_categories' || call.name === 'get_order_status_counts'
      || call.name === 'get_table_summary' || call.name === 'get_supported_payment_methods') {
    validateObjectArgs(call.args, []);
    return { ...call, args: {} };
  }
  if (call.name === 'get_order_details' || call.name === 'get_bill_for_order' || call.name === 'get_payments_for_order') {
    const args = validateObjectArgs(call.args, ['orderIdOrNumber']);
    return { ...call, args: validateRequiredIdentifier(args) };
  }
  if (call.name === 'list_orders') {
    const args = validateObjectArgs(call.args, ['status', 'tableId', 'activeOnly', 'limit']);
    if (args.status !== undefined && !['Open', 'In Progress', 'Completed', 'Cancelled'].includes(args.status)) {
      throw new TypeError('status is not a supported order status.');
    }
    validateOptionalString(args, 'tableId', 120);
    if (args.activeOnly !== undefined && typeof args.activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean.');
    return { ...call, args: { ...args, limit: validateLimit(args) } };
  }
  if (call.name === 'get_tables') {
    const args = validateObjectArgs(call.args, ['tableIdOrName', 'status', 'activeOnly', 'limit']);
    validateOptionalString(args, 'tableIdOrName', 120);
    if (args.status !== undefined && !['Available', 'Occupied', 'Reserved'].includes(args.status)) {
      throw new TypeError('status is not a supported table status.');
    }
    if (args.activeOnly !== undefined && typeof args.activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean.');
    return { ...call, args: { ...args, limit: validateLimit(args) } };
  }
  throw new TypeError('The model requested an unsupported assistant tool.');
}

function contentForModel(response, calls) {
  const content = response?.candidates?.[0]?.content;
  if (content && Array.isArray(content.parts) && content.parts.some(part => part?.functionCall)) return content;
  return {
    role: 'model',
    parts: calls.map(call => ({ functionCall: { name: call.name, args: call.args || {}, ...(call.id ? { id: call.id } : {}) } }))
  };
}

async function executeToolCall(call, analytics, requestId, round) {
  const startedAt = performance.now();
  logAssistantStage('analytics.start', requestId, { tool: call.name, round });
  try {
    let result;
    if (call.name === 'get_sales_summary') result = await analytics.getSalesSummary(call.args);
    else if (call.name === 'get_top_selling_items') result = await analytics.getTopSellingItems(call.args);
    else if (call.name === 'get_collected_revenue') result = await analytics.getCollectedRevenue(call.args);
    else if (call.name === 'search_menu_items') result = await searchMenuItems(call.args);
    else if (call.name === 'get_menu_categories') result = await getMenuCategories();
    else if (call.name === 'get_order_details') result = await getOrderDetails(call.args);
    else if (call.name === 'list_orders') result = await listOrders(call.args);
    else if (call.name === 'get_order_status_counts') result = await getOrderStatusCounts();
    else if (call.name === 'get_tables') result = await getTables(call.args);
    else if (call.name === 'get_table_summary') result = await getTableSummary();
    else if (call.name === 'get_bill_for_order') result = await getBillForOrder(call.args);
    else if (call.name === 'get_payments_for_order') result = await getPaymentsForOrder(call.args);
    else if (call.name === 'get_supported_payment_methods') result = await getSupportedPaymentMethods();
    else {
      const orders = await analytics.getPendingOrders();
      result = { orders: orders.slice(0, MAX_PENDING_ORDERS), truncated: orders.length > MAX_PENDING_ORDERS };
    }
    logAssistantStage('analytics.complete', requestId, { tool: call.name, round, elapsedMs: elapsedSince(startedAt) });
    return result;
  } catch (error) {
    logAssistantStage('analytics.failed', requestId, {
      tool: call.name,
      round,
      errorName: error?.name || 'Error',
      elapsedMs: elapsedSince(startedAt)
    });
    throw error;
  }
}

function getCalls(response) {
  if (Array.isArray(response?.functionCalls)) return response.functionCalls;
  const parts = response?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.flatMap(part => part?.functionCall ? [part.functionCall] : []) : [];
}

export async function answerAssistantQuestion(message, {
  generateContent = generateAIResponseWithTools,
  analytics = { getCollectedRevenue, getSalesSummary, getTopSellingItems, getPendingOrders },
  now = () => new Date(),
  requestId,
  history = []
} = {}) {
  const currentUtcDate = now().toISOString().slice(0, 10);
  const systemInstruction = [
    'You are a read-only assistant for this Restaurant POS application. Answer only questions about its menu, orders, kitchen tickets, tables, bills, payments, and sales.',
    'Use the provided database tools whenever a question asks for current or actual restaurant data. Never estimate or invent menu items, prices, order status, table status, bill amounts, payment details, or revenue.',
    'If a tool reports found=false, an empty list, a missing bill, or an unavailable field, say clearly that the information is unavailable. Do not fill gaps with guesses.',
    'For relative dates such as today, use UTC date ranges with an inclusive start and exclusive end. Today is ' + currentUtcDate + ' UTC.',
    'Order.status values are Open, In Progress, Completed, and Cancelled. Kitchen ticket (KOT) states such as Queued, Preparing, and Ready are separate from order status; explain that distinction when useful.',
    'MenuItem has an available boolean but no separate active field. Do not claim to know a separate inactive status.',
    'For bill totals distinguish Bill.grandTotal from amounts actually collected. Collected revenue is only completed payment amountApplied; report tips separately and never add bill totals to payments.',
    'Never reveal customer names, phone numbers, credentials, or private staff details. The tools do not provide those fields.',
    'You may use recent conversation history to resolve follow-up references, but current database facts must still come from tools.',
    'When a tool reports truncated=true, say the list is partial and do not imply it contains every matching record.',
    'Never perform or claim to perform write operations. All tools are read-only.',
    'Politely explain that you cannot help with unrelated general-purpose requests.'
  ].join(' ');
  if (!Array.isArray(history) || history.length > 12 || history.some(item => !item || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string' || item.text.length > 2000)) {
    throw new TypeError('history must contain at most 12 valid user and assistant messages.');
  }
  const contents = history.map(item => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.text }]
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });
  let executedCalls = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const startedAt = performance.now();
    logAssistantStage('gemini.start', requestId, { round: round + 1 });
    let response;
    try {
      response = await generateContent(contents, {
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
      }, { requestId, round: round + 1 });
      logAssistantStage('gemini.complete', requestId, {
        round: round + 1,
        functionCallCount: Array.isArray(response?.functionCalls) ? response.functionCalls.length : undefined,
        hasText: typeof response?.text === 'string' && Boolean(response.text.trim()),
        elapsedMs: elapsedSince(startedAt)
      });
    } catch (error) {
      logAssistantStage('gemini.failed', requestId, {
        round: round + 1,
        errorName: error?.name || 'Error',
        elapsedMs: elapsedSince(startedAt)
      });
      throw error;
    }
    if (!response || typeof response !== 'object') return 'I could not prepare a reliable answer. Please try again.';

    const calls = getCalls(response);
    if (!calls.length) {
      return typeof response.text === 'string' && response.text.trim()
        ? response.text.trim()
        : 'I could not prepare a reliable answer. Please try again.';
    }
    if (calls.length > 4 || executedCalls + calls.length > MAX_TOOL_CALLS) {
      throw new RangeError('The assistant exceeded its analytics tool-call limit.');
    }

    const validatedCalls = calls.map(validateToolCall);
    contents.push(contentForModel(response, validatedCalls));
    const functionResponses = [];
    for (const call of validatedCalls) {
      const output = await executeToolCall(call, analytics, requestId, round + 1);
      functionResponses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { output } } });
      executedCalls += 1;
    }
    contents.push({ role: 'user', parts: functionResponses });
  }

  throw new RangeError('The assistant exceeded its analytics tool-call round limit.');
}
