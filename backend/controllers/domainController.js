import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Table from '../models/Table.js';
import MenuItem from '../models/MenuItem.js';
import User from '../models/User.js';
import StaffProfile from '../models/StaffProfile.js';
import RestaurantSettings from '../models/RestaurantSettings.js';
import Order from '../models/Order.js';
import Kot from '../models/Kot.js';
import Bill from '../models/Bill.js';
import Payment from '../models/Payment.js';
import AuditEvent from '../models/AuditEvent.js';
import Notification from '../models/Notification.js';
import { permissions } from '../middleware/auth.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = doc => { if (!doc) return doc; const data = doc.toObject ? doc.toObject() : { ...doc }; const id = data.id || String(data._id || ''); delete data._id; delete data.__v; delete data.passwordHash; return { ...data, id }; };
const snapshot = user => ({ userId: user.staffProfileId || user.id, name: user.name, role: user.role });
const numericInput = value => (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
const money = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount * 100) > Number.MAX_SAFE_INTEGER) throw fail('Amount exceeds the supported monetary range.');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};
const tableNameKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function assertTableNameAvailable(name, excludingId, session) {
  const key = tableNameKey(name);
  const filter = { $or: [{ nameKey: key }, { name: new RegExp(`^${escapeRegex(String(name).trim().replace(/\s+/g, ' '))}$`, 'i') }] };
  if (excludingId) filter.id = { $ne: excludingId };
  let query = Table.exists(filter);
  if (session) query = query.session(session);
  if (await query) throw fail('A table with this name already exists.', 409);
  return key;
}
const calcTotals = (items, discount = 0, taxRate = 0.18) => {
  if (!Array.isArray(items)) throw fail('Bill items are invalid.');
  const subtotalMinor = items.reduce((sum, item) => {
    const unitMinor = Math.round(Number(item.unitPrice) * 100);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(unitMinor) || unitMinor < 0 || !Number.isSafeInteger(quantity) || quantity < 1) throw fail('Bill items contain an invalid price or quantity.');
    const lineMinor = unitMinor * quantity;
    if (!Number.isSafeInteger(lineMinor) || !Number.isSafeInteger(sum + lineMinor)) throw fail('Bill totals exceed the supported monetary range.');
    return sum + lineMinor;
  }, 0);
  const subtotal = subtotalMinor / 100;
  const discountMinor = Math.round(Number(discount) * 100);
  const rate = Number(taxRate);
  if (!Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > subtotalMinor) throw fail('Discount must be within the bill subtotal.');
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw fail('Tax rate must be between 0 and 1.');
  const taxMinor = Math.round((subtotalMinor - discountMinor) * rate);
  if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(subtotalMinor - discountMinor + taxMinor)) throw fail('Bill totals exceed the supported monetary range.');
  const taxAmount = taxMinor / 100;
  discount = discountMinor / 100;
  taxRate = rate;
  return { subtotal, discount, taxRate, taxAmount, grandTotal: money(subtotal - discount + taxAmount) };
};
export const listTables = async (_req, res, next) => { try { res.json({ tables: (await Table.find().sort({ createdAt: 1 }).lean()).map(clean) }); } catch (e) { next(e); } };
export async function listPayments(req,res,next){try{const filter={};for(const key of ['orderId','billId','status','method'])if(req.query[key]!==undefined){if(typeof req.query[key]!=='string')throw fail(`Invalid ${key} filter.`);filter[key]=req.query[key];}if(filter.status&&!['Completed','Pending','Failed','Refunded'].includes(filter.status))throw fail('Invalid payment status filter.');if(filter.method&&!['Cash','UPI','Card'].includes(filter.method))throw fail('Invalid payment method filter.');const payments=await Payment.find(filter).sort({createdAt:-1}).lean();res.json({payments:payments.map(clean)});}catch(e){next(e);}}
export async function listAuditEvents(req,res,next){try{const filter=req.query.orderId?{orderId:String(req.query.orderId)}:{};res.json({events:(await AuditEvent.find(filter).sort({createdAt:-1}).lean()).map(clean)});}catch(e){next(e);}}
export async function listNotifications(req,res,next){try{const filter=permissions[req.user.role]?.includes('notifications:manage')?{}:{recipientUserId:req.user.staffProfileId||req.user.id};res.json({notifications:(await Notification.find(filter).sort({createdAt:-1}).lean()).map(clean)});}catch(e){next(e);}}
export async function createTable(req, res, next) {
  try {
    const { name, capacity = 4 } = req.body || {};
    const normalizedName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!numericInput(capacity)) throw fail('Capacity must be numeric.');
    const parsedCapacity = Number(capacity);
    if (!normalizedName || normalizedName.length > 60 || !Number.isSafeInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 50) throw fail('A table name and capacity from 1 to 50 are required.');
    const nameKey = await assertTableNameAvailable(normalizedName);
    const table = await Table.create({ id: randomUUID(), name: normalizedName, nameKey, capacity: parsedCapacity });
    res.status(201).json({ table: clean(table) });
  } catch (e) { next(e); }
}
export async function updateTable(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const allowed = ['name','capacity','active','status'];
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.keys(req.body).length || Object.keys(req.body).some(key => !allowed.includes(key))) throw fail('Provide supported table changes only.');
    if (req.body.active !== undefined && typeof req.body.active !== 'boolean') throw fail('active must be a boolean.');
    if (req.body.status !== undefined && !['Available','Occupied','Reserved'].includes(req.body.status)) throw fail('Invalid table status.');
    if (req.body.capacity !== undefined && (!numericInput(req.body.capacity) || !Number.isSafeInteger(Number(req.body.capacity)) || Number(req.body.capacity) < 1 || Number(req.body.capacity) > 50)) throw fail('Capacity must be an integer from 1 to 50.');
    if (req.body.name !== undefined && (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 60)) throw fail('Table name must contain 1 to 60 characters.');
    let updated;
    await session.withTransaction(async () => {
      const table = await Table.findOne({ id: req.params.id }).session(session);
      if (!table) throw fail('Table not found.', 404);
      if (req.body.name !== undefined) {
        const normalizedName = req.body.name.trim().replace(/\s+/g, ' ');
        table.nameKey = await assertTableNameAvailable(normalizedName, table.id, session);
        table.name = normalizedName;
      }
      if (req.body.capacity !== undefined) table.capacity = Number(req.body.capacity);
      if (req.body.active !== undefined) table.active = req.body.active;
      if (req.body.status !== undefined) table.status = req.body.status;
      const hasOrders = await Order.exists({ orderType: 'DineIn', tableId: table.id, status: { $in: ['Open','In Progress'] } }).session(session);
      if (hasOrders && ((req.body.active === false) || (req.body.status && req.body.status !== 'Occupied'))) throw fail('A table with an active order cannot be deactivated or freed.', 409);
      table.seededDefault = false;
      await table.save({ session });
      updated = clean(table);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    res.json({ table: updated });
  } catch (e) { next(e); }
  finally { await session.endSession(); }
}
export async function createMenuItem(req, res, next) { try { const { name, price, description = '', category = '' } = req.body || {}; if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || typeof description !== 'string' || description.length > 1000 || typeof category !== 'string' || category.trim().length > 80 || !numericInput(price) || Number(price) <= 0) throw fail('Provide a menu name, valid description/category, and a price greater than zero.'); const item = await MenuItem.create({ id: randomUUID(), name: name.trim(), description, category: category.trim(), price: money(price), available: true }); res.status(201).json({ menuItem: clean(item) }); } catch (e) { next(e); } }
export const listMenu = async (_req, res, next) => { try { res.json({ menuItems: (await MenuItem.find().sort({ category: 1, name: 1 }).lean()).map(clean) }); } catch (e) { next(e); } };
export async function updateMenuItem(req, res, next) { try { const allowed = ['name','price','description','category','available']; if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.keys(req.body).length || Object.keys(req.body).some(key => !allowed.includes(key))) throw fail('Provide supported menu item changes only.'); const item = await MenuItem.findOne({ id: req.params.id }); if (!item) throw fail('Menu item not found.', 404); if (req.body.name !== undefined) { if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 120) throw fail('Menu item name must contain 1 to 120 characters.'); item.name = req.body.name.trim(); } if (req.body.price !== undefined) { if (!numericInput(req.body.price) || Number(req.body.price) <= 0) throw fail('Price must be greater than zero.'); item.price = money(req.body.price); } if (req.body.description !== undefined) { if (typeof req.body.description !== 'string' || req.body.description.length > 1000) throw fail('Description must be a string of at most 1000 characters.'); item.description = req.body.description; } if (req.body.category !== undefined) { if (typeof req.body.category !== 'string' || req.body.category.trim().length > 80) throw fail('Category must be a string of at most 80 characters.'); item.category = req.body.category.trim(); } if (req.body.available !== undefined) { if (typeof req.body.available !== 'boolean') throw fail('available must be a boolean.'); item.available = req.body.available; } item.seededDefault=false; await item.save(); res.json({ menuItem: clean(item) }); } catch (e) { next(e); } }
export async function getSettings(req, res, next) { try { const settings=clean(await RestaurantSettings.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true })); if(req.user.role==='Manager'){delete settings.gstNumber;delete settings.gstRate;delete settings.currency;} res.json({ settings }); } catch (e) { next(e); } }
export async function updateSettings(req, res, next) {
  try {
    const allFields = ['name','phone','address','gstNumber','gstRate','currency','receiptFooter'];
    const ownerOnly = ['gstNumber','gstRate','currency'];
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.keys(req.body).length || Object.keys(req.body).some(key => !allFields.includes(key))) throw fail('Provide supported restaurant settings only.');
    if (req.user.role !== 'Owner' && Object.keys(req.body).some(key => ownerOnly.includes(key))) throw fail('Only an Owner can change tax and currency settings.', 403);
    const allowed = req.user.role === 'Owner' ? allFields : allFields.filter(key => !ownerOnly.includes(key));
    const changes = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if (changes.name !== undefined && (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.trim().length > 120)) throw fail('Restaurant name must contain 1 to 120 characters.');
    if (changes.phone !== undefined && (typeof changes.phone !== 'string' || changes.phone.length > 40)) throw fail('Phone must be a string of at most 40 characters.');
    if (changes.address !== undefined && (typeof changes.address !== 'string' || changes.address.length > 400)) throw fail('Address must be a string of at most 400 characters.');
    if (changes.gstNumber !== undefined && (typeof changes.gstNumber !== 'string' || changes.gstNumber.length > 40)) throw fail('GST number must be a string of at most 40 characters.');
    if (changes.gstRate !== undefined && (!numericInput(changes.gstRate) || Number(changes.gstRate) < 0 || Number(changes.gstRate) > 1)) throw fail('GST rate must be between 0 and 1.');
    if (changes.currency !== undefined && !['INR','USD','EUR'].includes(changes.currency)) throw fail('Unsupported currency.');
    if (changes.receiptFooter !== undefined && (typeof changes.receiptFooter !== 'string' || changes.receiptFooter.length > 240)) throw fail('Receipt footer must be a string of at most 240 characters.');
    const settings = await RestaurantSettings.findOneAndUpdate({ key: 'default' }, { $set: { ...changes, seededDefault: false }, $setOnInsert: { key: 'default' } }, { upsert: true, new: true, runValidators: true });
    res.json({ settings: clean(settings) });
  } catch (e) { next(e); }
}

export async function listUsers(req, res, next) { try { const filter = req.user.role === 'Owner' ? {} : { role: 'Waiter' }; const users = await User.find(filter).sort({ createdAt: 1 }).lean(); res.json({ users: users.map(clean) }); } catch (e) { next(e); } }
export async function createUser(req, res, next) {
  const session=await mongoose.startSession();
  try {
    const {username,password,name,role}=req.body;
    if(typeof username!=='string'||!username.trim()||username.trim().length>120||typeof name!=='string'||!name.trim()||name.trim().length>120||!['Waiter','Cashier','Manager','Owner','Kitchen Staff'].includes(role)||typeof password!=='string'||password.length<10||password.length>128)throw fail('Provide username, name, a valid role, and a password of 10–128 characters.');
    if(req.user.role==='Manager'&&role!=='Waiter')throw fail('Managers can create Waiter accounts only.',403);
    if(role==='Owner'&&req.user.role!=='Owner')throw fail('Only an Owner can create an Owner account.',403);
    const normalizedUsername=username.trim().toLowerCase();let saved;
    await session.withTransaction(async()=>{
      let profile=role==='Waiter'?await StaffProfile.findOne({username:normalizedUsername}).session(session):null;
      if(profile){profile.active=true;profile.name=name.trim();await profile.save({session});}
      const [user]=await User.create([{username:normalizedUsername,name:name.trim(),role,...(profile?{staffProfileId:profile.id}:{}),passwordHash:await bcrypt.hash(password,12)}],{session});
      if(role==='Waiter'&&!profile){profile=new StaffProfile({id:user.id,username:normalizedUsername,name:name.trim(),active:true});await profile.save({session});}
      saved=user;
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    res.status(201).json({user:clean(saved)});
  }catch(e){next(e);}finally{await session.endSession();}
}
export async function updateUser(req, res, next) {
  const session=await mongoose.startSession();
  try {
    if(req.body.active!==undefined&&typeof req.body.active!=='boolean')throw fail('active must be a boolean.');
    if(Object.keys(req.body).some(key=>!['active','password'].includes(key)))throw fail('Only active status and password may be changed.');
    const user=await User.findById(req.params.id);if(!user)throw fail('User not found.',404);
    if(user.role==='Owner'&&req.user.role!=='Owner')throw fail('Only an Owner can manage an Owner account.',403);
    if(req.user.role==='Manager'&&(user.role!=='Waiter'||req.body.password!==undefined))throw fail('Managers may only activate or deactivate Waiter accounts.',403);
    if(user.id===req.user.id&&req.body.active===false)throw fail('You cannot deactivate your own account.',409);
    if(req.body.password!==undefined&&(typeof req.body.password!=='string'||req.body.password.length<10||req.body.password.length>128))throw fail('Password must be 10–128 characters.');
    if(req.body.active===undefined&&req.body.password===undefined)throw fail('No supported account change was provided.');
    let saved;
    await session.withTransaction(async()=>{
      const authChanged = (req.body.active !== undefined && req.body.active !== user.active) || req.body.password !== undefined;
      if(req.body.active!==undefined)user.active=req.body.active;
      if(req.body.password!==undefined)user.passwordHash=await bcrypt.hash(req.body.password,12);
      if(authChanged)user.authVersion=(user.authVersion||0)+1;
      await user.save({session});
      if(user.role==='Waiter'&&req.body.active!==undefined){
        const profileId=user.staffProfileId||user.id;
        await StaffProfile.updateOne({id:profileId},{$set:{active:req.body.active}},{session});
        if(req.body.active===false){
          await Order.updateMany({status:{$in:['Open','In Progress']},'assignedWaiter.userId':profileId},{$set:{assignedWaiter:null,assignmentStatus:'Unassigned',updatedAt:new Date()}},{session});
          await Notification.updateMany({recipientUserId:profileId,readAt:null},{$set:{recipientUserId:null,recipientName:null,type:'unassigned_kot_ready',title:'Unassigned KOT ready'}},{session});
        }
      }
      saved=user;
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    res.json({user:clean(saved)});
  }catch(e){next(e);}finally{await session.endSession();}
}

export async function createOrder(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { items: requested, orderType, tableId } = req.body || {};
    if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw fail('An order must contain between 1 and 100 menu item lines.');
    if (!['DineIn','Takeaway'].includes(orderType)) throw fail('Order type must be DineIn or Takeaway.');
    for (const field of ['customerName','customerPhone']) if (req.body[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length > (field === 'customerName' ? 120 : 40))) throw fail(`${field} must be a string of at most ${field === 'customerName' ? 120 : 40} characters.`);
    let result;
    await session.withTransaction(async () => {
      const settings = await RestaurantSettings.findOne({ key: 'default' }).session(session).lean();
      const lines = [];
      for (const line of requested) {
        if (!line || typeof line !== 'object' || Array.isArray(line)) throw fail('Each order line must be an object.');
        if (!numericInput(line.quantity)) throw fail('Item quantity must be numeric.');
        const qty = Number(line.quantity);
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999) throw fail('Item quantity must be an integer from 1 to 999.');
        if (line.notes !== undefined && (typeof line.notes !== 'string' || line.notes.length > 300)) throw fail('Item notes must be at most 300 characters.');
        const menu = await MenuItem.findOne({ id: String(line.menuItemId ?? line.id), available: true }).session(session);
        if (!menu) throw fail('An order contains a missing or unavailable menu item.');
        lines.push({ lineId: randomUUID(), menuItemId: menu.id, name: menu.name, unitPrice: menu.price, quantity: qty, notes: String(line.notes || '').slice(0, 300), category: menu.category || '' });
      }
      let table;
      if (orderType === 'DineIn') {
        if (tableId == null) throw fail('A table is required for a dine-in order.');
        table = await Table.findOne({ id: String(tableId), active: true, status: 'Available' }).session(session);
        if (!table) throw fail('The selected table is unavailable.', 409);
        if (await Order.exists({ orderType: 'DineIn', tableId: table.id, status: { $in: ['Open','In Progress'] } }).session(session)) throw fail('The selected table already has an active order.', 409);
      }
      const orderId = randomUUID(), kotId = randomUUID(), billId = randomUUID(), timestamp = new Date();
      const totals = calcTotals(lines, 0, settings?.gstRate ?? 0.18);
      let assignedWaiter = null;
      if (req.user.role === 'Waiter') {
        const profile = await StaffProfile.findOne({ id: req.user.staffProfileId || req.user.id, active: true }).session(session);
        if (!profile) throw fail('Waiter profile is inactive or unavailable.',403);
        assignedWaiter = { userId: profile.id, name: profile.name, username: profile.username };
      } else {
        const activeProfiles = await StaffProfile.find({ active: true }).sort({ createdAt: 1 }).session(session);
        if (activeProfiles.length) {
          const index = (settings?.roundRobinPointer || 0) % activeProfiles.length;
          const profile = activeProfiles[index];
          assignedWaiter = { userId: profile.id, name: profile.name, username: profile.username };
          await RestaurantSettings.updateOne({ key: 'default' }, { $set: { roundRobinPointer: (index + 1) % activeProfiles.length } }, { session });
        }
      }
      const order = { id: orderId, orderNumber: orderId.slice(0, 8).toUpperCase(), orderType, tableId: table?.id || null, table: table?.id || null, customerName: String(req.body.customerName || ''), customerPhone: String(req.body.customerPhone || ''), status: 'Open', paymentStatus: totals.grandTotal === 0 ? 'Paid' : 'Unpaid', items: lines, total: totals.subtotal, kotIds: [kotId], billId, createdBy: snapshot(req.user), assignedWaiter, assignmentStatus: assignedWaiter ? 'Assigned' : 'Unassigned' };
      const kot = { id: kotId, orderId, sequence: 1, kotNumber: 1, items: lines.map(item => ({ ...item, cancelledQuantity: 0, cancellations: [] })), status: 'Queued' };
      const bill = { id: billId, orderId, items: lines, ...totals, currency: settings?.currency || 'INR', status: totals.grandTotal === 0 ? 'Settled' : 'Open', ...(totals.grandTotal === 0 ? { settlementType: 'ZeroBalance', settledAt: timestamp, settledBy: snapshot(req.user) } : {}) };
      [result] = await Order.create([order], { session }); await Kot.create([kot], { session }); await Bill.create([bill], { session });
      if (table) { table.status = 'Occupied'; await table.save({ session }); }
      if (totals.grandTotal === 0) await AuditEvent.create([{ id: randomUUID(), orderId, action: 'bill_zero_balance_settled', reason: 'Zero balance', details: { billId } }], { session });
      result = { order, kot, bill };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    res.status(201).json(result);
  } catch (e) { next(e); } finally { await session.endSession(); }
}
export async function listOrders(req, res, next) { try { const actorIds=[...new Set([req.user.staffProfileId,req.user.id].filter(Boolean).map(String))]; const filter=req.user.role==='Waiter'?{ $or:[{'assignedWaiter.userId':{$in:actorIds}},{'createdBy.userId':{$in:actorIds}}] }:req.user.role==='Kitchen Staff'?{status:{$in:['Open','In Progress']}}:{}; let orders=(await Order.find(filter).sort({ createdAt: -1 }).lean()).map(clean); if(req.user.role==='Kitchen Staff')orders=orders.map(order=>{for(const key of ['customerName','customerPhone','total','paymentStatus','paymentMethod','billId','createdBy','assignedWaiter'])delete order[key];order.items=(order.items||[]).map(item=>{const sanitized={...item};delete sanitized.unitPrice;return sanitized;});return order;}); res.json({ orders }); } catch (e) { next(e); } }
export async function updateOrderStatus(req, res, next) {
  const session = await mongoose.startSession();
  try {
    if (!['Completed','Cancelled'].includes(req.body.status)) throw fail('Order status must be Completed or Cancelled.');
    if (req.body.override !== undefined && typeof req.body.override !== 'boolean') throw fail('override must be a boolean.');
    if (req.body.override && req.body.status !== 'Completed') throw fail('Only order completion can be overridden.');
    if (req.body.reason !== undefined && (typeof req.body.reason !== 'string' || req.body.reason.length > 300)) throw fail('Reason must be a string of at most 300 characters.');
    let updated;
    await session.withTransaction(async () => {
      const order = await Order.findOne({ id: req.params.id }).session(session);
      if (!order) throw fail('Order not found.', 404);
      const previousStatus = order.status;
      const nextStatus = req.body.status;
      const transitions = { Open: ['Completed', 'Cancelled'], 'In Progress': ['Completed', 'Cancelled'], Completed: [], Cancelled: [] };
      if (!transitions[order.status]?.includes(nextStatus)) throw fail(`Invalid order transition from ${order.status}.`, 409);
      const reason = String(req.body.reason || '').trim();
      const bill = await Bill.findOne({ orderId: order.id }).session(session);
      if (!bill) throw fail('Cannot close an order without its bill.', 409);
      const orderKots = await Kot.find({ orderId: order.id }).session(session);
      const pendingKots = orderKots.filter(kot => !['Served', 'Cancelled'].includes(kot.status));
      const paidRows = await Payment.aggregate([{ $match: { billId: bill.id, status: 'Completed' } }, { $group: { _id: null, totalMinor: { $sum: '$amountAppliedMinor' } } }]).session(session);
      const paidMinor = paidRows[0]?.totalMinor || 0;
      const dueMinor = Math.max(0, Math.round(bill.grandTotal * 100) - paidMinor);
      if (nextStatus === 'Completed') {
        const blockers = pendingKots.length > 0 || bill.status !== 'Settled' || dueMinor > 0;
        const isOverride = Boolean(req.body.override);
        if (blockers && (!isOverride || !reason)) throw fail('Completion requires all KOTs served and the bill paid; a Manager/Owner override requires a reason.', 409);
        if (isOverride && !['Manager','Owner'].includes(req.user.role)) throw fail('Only a Manager or Owner can override completion requirements.', 403);
        if (paidMinor > Math.round(bill.grandTotal * 100)) throw fail('Completed payments exceed the bill total.', 409);
        order.completionType = isOverride ? 'Override' : 'Normal';
        order.completionReason = isOverride ? reason : 'All non-cancelled KOTs served and bill paid.';
        order.completedBy = snapshot(req.user); order.completedAt = new Date();
        if (isOverride) { order.outstandingKotIds = pendingKots.map(kot => kot.id); order.unpaidAmount = dueMinor / 100; }
        if (isOverride) await Notification.updateMany({ orderId: order.id, resolvedAt: null }, { $set: { resolvedAt: new Date(), resolutionReason: 'Order completed by Manager/Owner override' } }, { session });
      }
      if (nextStatus === 'Cancelled') {
        if (!reason) throw fail('A cancellation reason is required.');
        if (paidMinor > 0) throw fail('An order with completed payments cannot be cancelled because refunds are not supported.', 409);
        if (bill.status === 'Settled' && bill.settlementType !== 'ZeroBalance') throw fail('A paid order cannot be cancelled.', 409);
        if (orderKots.some(kot => kot.status === 'Served')) throw fail('An order with served food cannot be cancelled.', 409);
        for (const kot of orderKots) if (['Queued','Preparing','Ready'].includes(kot.status)) { kot.status='Cancelled'; kot.cancellationReason=reason; kot.cancelledBy=snapshot(req.user); await kot.save({session}); }
        if (bill.status === 'Open') { bill.status='Void'; bill.voidedAt=new Date(); bill.voidReason=reason; await bill.save({session}); }
        await Notification.updateMany({ orderId: order.id, resolvedAt: null }, { $set: { resolvedAt: new Date(), resolutionReason: 'Order cancelled' } }, { session });
        order.cancelledBy=snapshot(req.user); order.cancelledAt=new Date(); order.cancellationReason=reason;
      }
      order.status = nextStatus;
      await order.save({ session });
      if (order.tableId) {
        const active = await Order.exists({ id: { $ne: order.id }, tableId: order.tableId, orderType: 'DineIn', status: { $in: ['Open','In Progress'] } }).session(session);
        if (!active) await Table.updateOne({ id: order.tableId }, { $set: { status: 'Available' } }, { session });
      }
      await AuditEvent.create([{ id: randomUUID(), orderId: order.id, action: nextStatus === 'Completed' && req.body.override ? 'order_completion_override' : `order_${nextStatus.toLowerCase()}`, previousStatus, newStatus: nextStatus, reason: req.body.override ? reason : (reason || order.completionReason), details: { outstandingKotIds: order.outstandingKotIds || [], unpaidAmount: order.unpaidAmount || 0 }, actor: snapshot(req.user) }], { session });
      updated = clean(order);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    res.json({ order: updated });
  } catch (error) { next(error); }
  finally { await session.endSession(); }
}


export async function listBills(_req,res,next){try{const bills=await Bill.find().sort({createdAt:-1}).lean();res.json({bills:bills.map(clean)});}catch(e){next(e);}}

export async function addOrderItems(req, res, next) {
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => {
    const order = await Order.findOne({ id: req.params.id }).session(session);
    if (!order || !['Open','In Progress'].includes(order.status)) throw fail('Items can only be added to an active order.',409);
    if (req.user.role === 'Waiter' && order.assignedWaiter?.userId !== (req.user.staffProfileId || req.user.id)) throw fail('Waiters may add items only to orders assigned to them.',403);
    if (!Array.isArray(req.body.items) || !req.body.items.length || req.body.items.length > 100) throw fail('Provide between 1 and 100 new item lines.');
    const newLines = [];
    for (const request of req.body.items) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw fail('Each item must be an object.');
      const quantity = Number(request.quantity);
      if (!numericInput(request.quantity) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw fail('Each item must have a quantity from 1 to 999.');
      if (request.notes !== undefined && (typeof request.notes !== 'string' || request.notes.length > 300)) throw fail('Item notes must be at most 300 characters.');
      const menu = await MenuItem.findOne({ id: String(request.menuItemId ?? request.id), available: true }).session(session);
      if (!menu) throw fail('An order contains a missing or unavailable menu item.');
      newLines.push({ lineId: randomUUID(), menuItemId: menu.id, name: menu.name, unitPrice: menu.price, quantity, notes: String(request.notes || '').slice(0,300), category: menu.category || '' });
    }
    const kots = await Kot.find({ orderId: order.id }).session(session);
    const sequence = kots.reduce((max,kot) => Math.max(max, kot.sequence || 0),0)+1;
    const kotId = randomUUID();
    await Kot.create([{ id: kotId, orderId: order.id, sequence, kotNumber: sequence, items: newLines.map(x => ({ ...x, cancelledQuantity: 0, cancellations: [] })), status: 'Queued' }], { session });
    order.items.push(...newLines); order.kotIds.push(kotId); order.total = money(order.items.reduce((s,x)=>s+x.unitPrice*x.quantity,0)); await order.save({ session });
    const bill = await Bill.findOne({ orderId: order.id }).session(session); if (!bill || bill.status !== 'Open') throw fail('An open bill is required to add items.',409);
    const kotItems = await Kot.find({ orderId: order.id, status: { $ne: 'Cancelled' } }).session(session);
    bill.items = kotItems.flatMap(k => k.items.map(x => ({ ...x.toObject(), quantity: Math.max(0,x.quantity-(x.cancelledQuantity||0)) })).filter(x=>x.quantity>0));
    const totals = calcTotals(bill.items, bill.discount, bill.taxRate); Object.assign(bill,totals); await bill.save({session});
    result = { order: clean(order), kot: clean(await Kot.findOne({id:kotId}).session(session)), bill: clean(bill) };
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}}); res.status(201).json(result); } catch(e) { next(e); } finally { await session.endSession(); }
}

export async function updateBillDiscount(req,res,next) { const session=await mongoose.startSession(); try { let billResult; if(!numericInput(req.body.discount))throw fail('Discount must be a valid amount.'); await session.withTransaction(async()=>{ const bill=await Bill.findOne({orderId:req.params.orderId,status:'Open'}).session(session); if(!bill) throw fail('Open bill not found.',404); const discount=Number(req.body.discount); const totals=calcTotals(bill.items,discount,bill.taxRate); const received=await Payment.aggregate([{ $match:{billId:bill.id,status:'Completed'}},{ $group:{_id:null,totalMinor:{$sum:'$amountAppliedMinor'}}}]).session(session); if((received[0]?.totalMinor||0)>Math.round(totals.grandTotal*100)) throw fail('Discount cannot reduce the balance below completed payments.',409); Object.assign(bill,totals); if(totals.grandTotal===0 && !(received[0]?.totalMinor>0)){bill.status='Settled'; bill.settlementType='ZeroBalance';bill.settledAt=new Date();bill.settledBy=snapshot(req.user);} await bill.save({session}); billResult=clean(bill); }); res.json({bill:billResult}); } catch(e){next(e);} finally{await session.endSession();} }

export async function updateBillStatus(req,res,next){const session=await mongoose.startSession();try{let result;await session.withTransaction(async()=>{const bill=await Bill.findOne({orderId:req.params.orderId}).session(session);if(!bill)throw fail('Bill not found.',404);if(req.body.status!=='Void'||bill.status!=='Open')throw fail('Only an open bill can be voided.',409);const order=await Order.findOne({id:bill.orderId}).session(session);if(!order||order.status!=='Cancelled')throw fail('A bill can be voided only after its order is cancelled.',409);if(await Payment.exists({billId:bill.id,status:'Completed'}).session(session))throw fail('A bill with completed payments cannot be voided.',409);bill.status='Void';bill.voidedAt=new Date();bill.voidReason=String(req.body.reason||order.cancellationReason||'Order cancelled').slice(0,300);await bill.save({session});await AuditEvent.create([{id:randomUUID(),orderId:order.id,action:'bill_voided',reason:bill.voidReason,actor:snapshot(req.user)}],{session});result=clean(bill);});res.json({bill:result});}catch(e){next(e);}finally{await session.endSession();}}

export async function recordPayment(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const key = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim();
    if (!numericInput(req.body.amountApplied) || (req.body.tipAmount !== undefined && !numericInput(req.body.tipAmount)) || (req.body.cashTendered !== undefined && !numericInput(req.body.cashTendered))) throw fail('Payment amounts must be numeric.');
    const appliedMinor = Math.round(Number(req.body.amountApplied) * 100);
    const tipMinor = Math.round(Number(req.body.tipAmount || 0) * 100);
    const method = req.body.method;
    const status = req.body.status || 'Completed';
    if (key.length < 8 || key.length > 120) throw fail('A valid Idempotency-Key header is required.');
    if (!Number.isSafeInteger(appliedMinor) || appliedMinor <= 0 || !Number.isSafeInteger(tipMinor) || tipMinor < 0 || !Number.isSafeInteger(appliedMinor + tipMinor)) throw fail('Payment and tip amounts are invalid.');
    if (!['Cash', 'UPI', 'Card'].includes(method)) throw fail('Method must be Cash, UPI or Card.');
    if (!['Completed', 'Pending', 'Failed'].includes(status)) throw fail('Invalid payment status.');
    const requestedCashMinor = method === 'Cash' && req.body.cashTendered != null
      ? Math.round(Number(req.body.cashTendered) * 100)
      : (method === 'Cash' ? appliedMinor + tipMinor : null);
    if (method === 'Cash' && (!Number.isSafeInteger(requestedCashMinor) || requestedCashMinor < appliedMinor + tipMinor)) throw fail('Cash tendered must cover amount and tip.');
    let result;
    let duplicate = false;
    await session.withTransaction(async () => {
      const existing = await Payment.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        const sameRequest = existing.orderId === req.params.orderId
          && existing.method === method
          && Number(existing.amountAppliedMinor ?? Math.round(Number(existing.amountApplied) * 100)) === appliedMinor
          && Number(existing.tipMinor ?? Math.round(Number(existing.tipAmount || 0) * 100)) === tipMinor
          && existing.status === status
          && (method !== 'Cash' || Number(existing.cashTenderedMinor ?? Math.round(Number(existing.cashTendered || 0) * 100)) === requestedCashMinor);
        if (!sameRequest) throw fail('This Idempotency-Key was already used for a different payment request.', 409);
        result = clean(existing);
        duplicate = true;
        return;
      }
      const order = await Order.findOne({ id: req.params.orderId }).session(session);
      const bill = await Bill.findOne({ orderId: req.params.orderId, status: 'Open' }).session(session);
      if (!order || order.status === 'Cancelled' || !bill) throw fail('An active order and open bill are required.', 409);
      const billMinor = Math.round(Number(bill.grandTotal) * 100);
      const paidRows = await Payment.aggregate([{ $match: { billId: bill.id, status: 'Completed' } }, { $group: { _id: null, paid: { $sum: '$amountAppliedMinor' } } }]).session(session);
      const paidMinor = paidRows[0]?.paid || 0;
      const balanceMinor = Math.max(0, billMinor - paidMinor);
      if (appliedMinor > balanceMinor) throw fail('Payment exceeds the outstanding balance.', 409);
      const cashChangeMinor = method === 'Cash' ? requestedCashMinor - appliedMinor - tipMinor : 0;
      const applied = appliedMinor / 100;
      const tip = tipMinor / 100;
      const payment = {
        id: randomUUID(), idempotencyKey: key, orderId: order.id, billId: bill.id,
        method, amount: applied, amountApplied: applied, amountAppliedMinor: appliedMinor,
        tipAmount: tip, tipMinor, totalDueFromCustomer: (appliedMinor + tipMinor) / 100,
        totalDueFromCustomerMinor: appliedMinor + tipMinor,
        totalAmountReceivedOrCharged: (method === 'Cash' ? requestedCashMinor : appliedMinor + tipMinor) / 100,
        totalAmountMinor: method === 'Cash' ? requestedCashMinor : appliedMinor + tipMinor,
        amountCharged: method === 'Cash' ? null : (appliedMinor + tipMinor) / 100,
        amountChargedMinor: method === 'Cash' ? null : appliedMinor + tipMinor,
        cashTendered: method === 'Cash' ? requestedCashMinor / 100 : null,
        cashTenderedMinor: method === 'Cash' ? requestedCashMinor : null,
        changeReturned: cashChangeMinor / 100, changeReturnedMinor: cashChangeMinor,
        status, mode: appliedMinor === balanceMinor ? 'Full' : 'Partial',
        recordedBy: snapshot(req.user), timestamp: new Date()
      };
      const [saved] = await Payment.create([payment], { session });
      const nextPaidMinor = paidMinor + (status === 'Completed' ? appliedMinor : 0);
      if (status === 'Completed' && nextPaidMinor === billMinor) {
        bill.status = 'Settled';
        bill.settledAt = new Date();
        await bill.save({ session });
      }
      order.paymentStatus = nextPaidMinor >= billMinor ? 'Paid' : nextPaidMinor > 0 ? 'Partially Paid' : 'Unpaid';
      await order.save({ session });
      result = clean(saved);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    res.status(duplicate ? 200 : 201).json({ payment: result, ...(duplicate ? { duplicate: true } : {}) });
  } catch (error) {
    if (error.code === 11000) {
      const key = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim();
      const duplicate = await Payment.findOne({ idempotencyKey: key });
      if (duplicate && duplicate.orderId === req.params.orderId
        && duplicate.method === req.body.method
        && Number(duplicate.amountAppliedMinor ?? Math.round(Number(duplicate.amountApplied) * 100)) === Math.round(Number(req.body.amountApplied) * 100)
        && Number(duplicate.tipMinor ?? Math.round(Number(duplicate.tipAmount || 0) * 100)) === Math.round(Number(req.body.tipAmount || 0) * 100)
        && duplicate.status === (req.body.status || 'Completed')
        && (req.body.method !== 'Cash' || Number(duplicate.cashTenderedMinor ?? Math.round(Number(duplicate.cashTendered || 0) * 100)) === (req.body.cashTendered == null ? Math.round((Number(req.body.amountApplied) + Number(req.body.tipAmount || 0)) * 100) : Math.round(Number(req.body.cashTendered) * 100)))) {
        return res.status(200).json({ payment: clean(duplicate), duplicate: true });
      }
      if (duplicate) return next(fail('This Idempotency-Key was already used for a different payment request.', 409));
    }
    next(error);
  } finally {
    await session.endSession();
  }
}
export async function getReports(req, res, next) { try { const includeItems = permissions[req.user.role]?.includes('reports:itemwise'); const [paymentRows, orderCount, itemRows] = await Promise.all([Payment.aggregate([{ $match: { status: 'Completed' } }, { $group: { _id: null, revenue: { $sum: '$amountApplied' }, tips: { $sum: '$tipAmount' }, count: { $sum: 1 } } }]), Order.countDocuments(), includeItems ? Order.aggregate([{ $unwind: '$items' }, { $group: { _id: '$items.name', quantity: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.unitPrice','$items.quantity'] } } } }, { $sort: { quantity: -1 } }]) : Promise.resolve(undefined)]); res.json({ revenue: paymentRows[0]?.revenue || 0, tips: paymentRows[0]?.tips || 0, payments: paymentRows[0]?.count || 0, orderCount, ...(includeItems ? { items: itemRows } : {}) }); } catch(e) { next(e); } }
export async function health(_req, res) { try { if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw new Error('Database is not connected.'); await mongoose.connection.db.command({ ping: 1, maxTimeMS: 1000 }); return res.json({ status: 'ok', database: 'connected' }); } catch { return res.status(503).json({ status: 'unavailable', database: 'disconnected' }); } }
