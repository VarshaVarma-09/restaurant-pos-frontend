import Table from '../models/Table.js';
import MenuItem from '../models/MenuItem.js';
import Order from '../models/Order.js';
import Kot from '../models/Kot.js';
import Bill from '../models/Bill.js';
import Payment from '../models/Payment.js';
import AuditEvent from '../models/AuditEvent.js';
import Notification from '../models/Notification.js';
import RestaurantSettings from '../models/RestaurantSettings.js';
import StaffProfile from '../models/StaffProfile.js';

const defaults = {
  restaurantSettings: { name: 'My Restaurant', phone: '', address: '', gstNumber: '', gstRate: 0.18, currency: 'INR', receiptFooter: '' }
};
const actorIds = user => [...new Set([user.staffProfileId, user.id].filter(Boolean).map(String))];
const clean = doc => { const value = { ...doc }; delete value._id; delete value.__v; delete value.key; return value; };

export async function getState(req, res, next) {
  try {
    const [tables, menuItems, orders, kots, bills, payments, auditEvents, notifications, waiters, settings] = await Promise.all([
      Table.find().lean(), MenuItem.find().lean(), Order.find().lean(), Kot.find().lean(), Bill.find().lean(), Payment.find().lean(), AuditEvent.find().lean(), Notification.find().lean(), StaffProfile.find().lean(), RestaurantSettings.findOne({ key: 'default' }).lean()
    ]);
    const restaurantSettings = settings ? clean(settings) : { ...defaults.restaurantSettings };
    delete restaurantSettings.roundRobinPointer;
    let visibleOrders=orders.map(clean), visibleKots=kots.map(clean), visibleBills=bills.map(clean), visiblePayments=payments.map(clean), visibleAudit=auditEvents.map(clean), visibleNotes=notifications.map(clean), visibleWaiters=waiters.map(clean), visibleMenuItems=menuItems.map(clean);
    if (req.user.role === 'Waiter') {
      const actors=new Set(actorIds(req.user)); visibleOrders=visibleOrders.filter(order=>actors.has(String(order.assignedWaiter?.userId))||actors.has(String(order.createdBy?.userId)));
      const actor=req.user.staffProfileId||req.user.id;
      const orderIds=new Set(visibleOrders.map(order=>order.id)); visibleKots=visibleKots.filter(kot=>orderIds.has(kot.orderId));
      visibleNotes=visibleNotes.filter(note=>note.recipientUserId===actor); visibleBills=[];visiblePayments=[];visibleAudit=[];visibleWaiters=[];
    } else if (req.user.role === 'Kitchen Staff') {
      visibleBills=[];visiblePayments=[];visibleAudit=[];visibleNotes=[];visibleWaiters=[];
      visibleOrders=visibleOrders.filter(order=>['Open','In Progress'].includes(order.status)).map(order=>{for(const key of ['customerName','customerPhone','total','paymentStatus','paymentMethod','billId','createdBy','assignedWaiter'])delete order[key];order.items=(order.items||[]).map(item=>{const sanitized={...item};delete sanitized.unitPrice;return sanitized;});return order;});
      visibleKots=visibleKots.map(kot=>({...kot,items:(kot.items||[]).map(item=>{const sanitized={...item};delete sanitized.unitPrice;delete sanitized.menuItemId;return sanitized;})}));
      visibleMenuItems=visibleMenuItems.map(item=>{delete item.price;return item;});
    } else if (req.user.role === 'Cashier') {
      visibleKots=[];visibleAudit=[];visibleNotes=[];visibleWaiters=[];
    }
    if (req.user.role !== 'Owner') delete restaurantSettings.gstNumber;
    if (req.user.role === 'Manager') {
      delete restaurantSettings.gstRate;
      delete restaurantSettings.currency;
    }
    res.json({ data: {
      tables: tables.map(clean),
      menuItems: visibleMenuItems,
      orders: visibleOrders, kots: visibleKots, bills: visibleBills, payments: visiblePayments,
      auditEvents: visibleAudit, notifications: visibleNotes, waiters: visibleWaiters,
      roundRobinPointer: settings?.roundRobinPointer || 0, restaurantSettings
    }, source: 'domain-collections' });
  } catch (error) { next(error); }
}
