import Bill from '../models/Bill.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';

function dateRange(start, end, field) {
  const range = {};
  if (start !== undefined) {
    const value = new Date(start);
    if (Number.isNaN(value.getTime())) throw new TypeError('start must be a valid date.');
    range.$gte = value;
  }
  if (end !== undefined) {
    const value = new Date(end);
    if (Number.isNaN(value.getTime())) throw new TypeError('end must be a valid date.');
    range.$lt = value;
  }
  if (range.$gte && range.$lt && range.$gte >= range.$lt) {
    throw new RangeError('start must be earlier than end.');
  }
  return Object.keys(range).length ? { [field]: range } : {};
}

export async function getCollectedRevenue({ start, end } = {}) {
  const match = {
    status: 'Completed',
    ...dateRange(start, end, 'timestamp')
  };
  const [totals] = await Payment.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        revenueMinor: { $sum: { $ifNull: ['$amountAppliedMinor', 0] } },
        tipsMinor: { $sum: { $ifNull: ['$tipMinor', 0] } },
        payments: { $sum: 1 }
      }
    }
  ]);

  return {
    revenue: (totals?.revenueMinor || 0) / 100,
    tips: (totals?.tipsMinor || 0) / 100,
    payments: totals?.payments || 0
  };
}

export async function getSalesSummary({ start, end } = {}) {
  const orderDateFilter = dateRange(start, end, 'createdAt');
  const [collected, orderCount, cancelledOrderCount] = await Promise.all([
    getCollectedRevenue({ start, end }),
    Order.countDocuments({ ...orderDateFilter, status: { $ne: 'Cancelled' } }),
    Order.countDocuments({ ...orderDateFilter, status: 'Cancelled' })
  ]);

  return { ...collected, orderCount, cancelledOrderCount };
}

export async function getTopSellingItems({ start, end, limit = 10 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('limit must be an integer from 1 to 50.');
  }

  const match = {
    status: 'Settled'
  };
  const dateFilter = dateRange(start, end, 'analyticsDate');

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: Order.collection.collectionName,
        localField: 'orderId',
        foreignField: 'id',
        as: 'associatedOrder'
      }
    },
    { $unwind: '$associatedOrder' },
    { $match: { 'associatedOrder.status': { $ne: 'Cancelled' } } },
    {
      $addFields: {
        analyticsDate: { $ifNull: ['$settledAt', '$createdAt'] }
      }
    },
    ...(Object.keys(dateFilter).length ? [{ $match: dateFilter }] : []),
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          itemId: {
            $ifNull: [
              '$items.menuItemId',
              { $concat: ['legacy:', '$items.name'] }
            ]
          },
          name: '$items.name'
        },
        quantity: { $sum: '$items.quantity' },
        revenue: {
          $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] }
        }
      }
    },
    { $sort: { quantity: -1, revenue: -1, '_id.name': 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        menuItemId: '$_id.itemId',
        name: '$_id.name',
        quantity: 1,
        revenue: 1
      }
    }
  ];

  return Bill.aggregate(pipeline);
}

export async function getPendingOrders() {
  return Order.find({ status: { $in: ['Open', 'In Progress'] } })
    .select('-_id id orderNumber orderType tableId status paymentStatus createdAt updatedAt')
    .sort({ createdAt: -1 })
    .lean();
}
