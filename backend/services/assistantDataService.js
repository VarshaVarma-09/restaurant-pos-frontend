import Bill from '../models/Bill.js';
import Kot from '../models/Kot.js';
import MenuItem from '../models/MenuItem.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Table from '../models/Table.js';

const ACTIVE_ORDER_STATUSES = ['Open', 'In Progress'];
const ORDER_STATUSES = ['Open', 'In Progress', 'Completed', 'Cancelled'];
const TABLE_STATUSES = ['Available', 'Occupied', 'Reserved'];
const MAX_RESULTS = 50;

function limitValue(limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_RESULTS}.`);
  }
  return limit;
}

function safeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function publicOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    tableId: order.tableId || null,
    status: order.status,
    paymentStatus: order.paymentStatus,
    items: (order.items || []).map(item => ({
      name: item.name,
      category: item.category || '',
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: Math.round(item.unitPrice * item.quantity * 100) / 100
    })),
    orderSubtotal: order.total,
    createdAt: order.createdAt
  };
}

async function findOrder(identifier) {
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 120) {
    throw new TypeError('orderIdOrNumber must be a non-empty string of at most 120 characters.');
  }
  const value = identifier.trim();
  return Order.findOne({ $or: [{ id: value }, { orderNumber: value }] })
    .select('id orderNumber orderType tableId status paymentStatus items total createdAt')
    .lean();
}

export async function searchMenuItems({ query, category, availability = 'available', limit = 20 } = {}) {
  limit = limitValue(limit);
  if (availability !== 'available' && availability !== 'unavailable' && availability !== 'all') {
    throw new TypeError('availability must be available, unavailable, or all.');
  }
  const filter = {};
  if (typeof query === 'string' && query.trim()) {
    if (query.length > 120) throw new RangeError('query must be at most 120 characters.');
    const expression = new RegExp(safeRegex(query.trim()), 'i');
    filter.$or = [{ name: expression }, { description: expression }];
  } else if (query !== undefined && typeof query !== 'string') {
    throw new TypeError('query must be a string.');
  }
  if (category !== undefined) {
    if (typeof category !== 'string' || category.length > 80) throw new TypeError('category must be a string of at most 80 characters.');
    filter.category = new RegExp(`^${safeRegex(category.trim())}$`, 'i');
  }
  if (availability !== 'all') filter.available = availability === 'available';

  const items = await MenuItem.find(filter)
    .select('id name description category price available')
    .sort({ category: 1, name: 1 })
    .limit(limit + 1)
    .lean();
  return {
    items: items.slice(0, limit).map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price,
      available: item.available
    })),
    truncated: items.length > limit,
    limit,
    availabilityField: 'available',
    separateActiveFieldSupported: false
  };
}

export async function getMenuCategories() {
  const categories = await MenuItem.distinct('category');
  return {
    categories: [...new Set(categories.map(value => String(value || '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
    uncategorizedItemsExist: categories.some(value => !String(value || '').trim())
  };
}

export async function getOrderDetails({ orderIdOrNumber } = {}) {
  const order = await findOrder(orderIdOrNumber);
  if (!order) return { found: false };
  const bill = await Bill.findOne({ orderId: order.id })
    .select('status subtotal discount taxRate taxAmount grandTotal currency settledAt')
    .lean();
  return {
    found: true,
    order: publicOrder(order),
    bill: bill ? {
      status: bill.status,
      subtotal: bill.subtotal,
      discount: bill.discount,
      taxRate: bill.taxRate,
      taxAmount: bill.taxAmount,
      grandTotal: bill.grandTotal,
      currency: bill.currency,
      settledAt: bill.settledAt || null
    } : null
  };
}

export async function listOrders({ status, tableId, activeOnly = false, limit = 20 } = {}) {
  limit = limitValue(limit);
  if (status !== undefined && !ORDER_STATUSES.includes(status)) throw new TypeError('status is not a supported order status.');
  if (tableId !== undefined && (typeof tableId !== 'string' || !tableId.trim() || tableId.length > 120)) {
    throw new TypeError('tableId must be a non-empty string of at most 120 characters.');
  }
  if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean.');
  const filter = {};
  if (activeOnly) filter.status = { $in: ACTIVE_ORDER_STATUSES };
  else if (status) filter.status = status;
  if (tableId !== undefined) filter.tableId = tableId.trim();
  const orders = await Order.find(filter)
    .select('id orderNumber orderType tableId status paymentStatus items total createdAt')
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  return { orders: orders.slice(0, limit).map(publicOrder), truncated: orders.length > limit, limit };
}

export async function getOrderStatusCounts() {
  const [orderRows, kitchenRows] = await Promise.all([
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Kot.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, orderIds: { $addToSet: '$orderId' } } }])
  ]);
  const orderCounts = Object.fromEntries(ORDER_STATUSES.map(status => [status, orderRows.find(row => row._id === status)?.count || 0]));
  const kitchenTicketCounts = Object.fromEntries(
    ['Queued', 'Preparing', 'Ready', 'Served', 'Cancelled', 'Closed']
      .map(status => [status, kitchenRows.find(row => row._id === status)?.count || 0])
  );
  return {
    orderCounts,
    kitchenTicketCounts,
    ordersWithPreparingTickets: kitchenRows.find(row => row._id === 'Preparing')?.orderIds.length || 0,
    ordersWithReadyTickets: kitchenRows.find(row => row._id === 'Ready')?.orderIds.length || 0
  };
}

export async function getTables({ tableIdOrName, status, activeOnly = true, limit = 20 } = {}) {
  limit = limitValue(limit);
  if (status !== undefined && !TABLE_STATUSES.includes(status)) throw new TypeError('status is not a supported table status.');
  if (tableIdOrName !== undefined && (typeof tableIdOrName !== 'string' || !tableIdOrName.trim() || tableIdOrName.length > 120)) {
    throw new TypeError('tableIdOrName must be a non-empty string of at most 120 characters.');
  }
  if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean.');
  const filter = {};
  if (activeOnly) filter.active = true;
  if (status) filter.status = status;
  if (tableIdOrName !== undefined) {
    const value = tableIdOrName.trim();
    filter.$or = [{ id: value }, { name: new RegExp(`^${safeRegex(value)}$`, 'i') }];
  }
  const tables = await Table.find(filter)
    .select('id name capacity status active')
    .sort({ name: 1 })
    .limit(limit + 1)
    .lean();
  const returnedTables = tables.slice(0, limit);
  const ids = returnedTables.map(table => table.id);
  const activeOrders = ids.length ? await Order.find({
    orderType: 'DineIn',
    tableId: { $in: ids },
    status: { $in: ACTIVE_ORDER_STATUSES }
  }).select('id orderNumber tableId status paymentStatus createdAt').sort({ createdAt: -1 }).lean() : [];
  const ordersByTable = new Map();
  for (const order of activeOrders) {
    const orders = ordersByTable.get(order.tableId) || [];
    orders.push({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt
    });
    ordersByTable.set(order.tableId, orders);
  }
  return {
    tables: returnedTables.map(table => ({ ...table, activeOrders: ordersByTable.get(table.id) || [] })),
    truncated: tables.length > limit,
    limit
  };
}

export async function getTableSummary() {
  const rows = await Table.aggregate([
    { $group: { _id: { active: '$active', status: '$status' }, count: { $sum: 1 } } }
  ]);
  const countFor = (active, status) => rows.find(row => row._id.active === active && row._id.status === status)?.count || 0;
  return {
    activeTables: rows.filter(row => row._id.active === true).reduce((sum, row) => sum + row.count, 0),
    available: countFor(true, 'Available'),
    occupied: countFor(true, 'Occupied'),
    reserved: countFor(true, 'Reserved'),
    inactiveTables: rows.filter(row => row._id.active === false).reduce((sum, row) => sum + row.count, 0)
  };
}

export async function getBillForOrder({ orderIdOrNumber } = {}) {
  const order = await findOrder(orderIdOrNumber);
  if (!order) return { found: false };
  const bill = await Bill.findOne({ orderId: order.id })
    .select('id status subtotal discount taxRate taxAmount grandTotal currency settledAt')
    .lean();
  if (!bill) return { found: true, orderNumber: order.orderNumber, paymentStatus: order.paymentStatus, bill: null };
  const payments = await Payment.aggregate([
    { $match: { billId: bill.id, status: 'Completed' } },
    { $group: {
      _id: null,
      amountAppliedMinor: { $sum: { $ifNull: ['$amountAppliedMinor', 0] } },
      tipMinor: { $sum: { $ifNull: ['$tipMinor', 0] } },
      count: { $sum: 1 }
    } }
  ]);
  const amountPaidMinor = payments[0]?.amountAppliedMinor || 0;
  return {
    found: true,
    orderNumber: order.orderNumber,
    paymentStatus: order.paymentStatus,
    bill: {
      status: bill.status,
      subtotal: bill.subtotal,
      discount: bill.discount,
      taxRate: bill.taxRate,
      taxAmount: bill.taxAmount,
      grandTotal: bill.grandTotal,
      currency: bill.currency,
      settledAt: bill.settledAt || null,
      completedPaymentCount: payments[0]?.count || 0,
      amountPaid: amountPaidMinor / 100,
      tips: (payments[0]?.tipMinor || 0) / 100,
      balanceDue: bill.status === 'Void'
        ? null
        : Math.max(0, Math.round(bill.grandTotal * 100) - amountPaidMinor) / 100
    }
  };
}

export async function getPaymentsForOrder({ orderIdOrNumber } = {}) {
  const order = await findOrder(orderIdOrNumber);
  if (!order) return { found: false, payments: [] };
  const payments = await Payment.find({ orderId: order.id })
    .select('method amountAppliedMinor tipMinor status mode timestamp')
    .sort({ timestamp: 1 })
    .lean();
  return {
    found: true,
    orderNumber: order.orderNumber,
    payments: payments.map(payment => ({
      method: payment.method,
      amountApplied: (payment.amountAppliedMinor || 0) / 100,
      tip: (payment.tipMinor || 0) / 100,
      status: payment.status,
      mode: payment.mode,
      timestamp: payment.timestamp
    }))
  };
}

export async function getSupportedPaymentMethods() {
  return { methods: [...Payment.schema.path('method').enumValues] };
}
