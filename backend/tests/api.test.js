import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../app.js';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import StaffAuditEvent from '../models/StaffAuditEvent.js';
import StaffProfile from '../models/StaffProfile.js';
import Table from '../models/Table.js';
import MenuItem from '../models/MenuItem.js';
import RestaurantSettings from '../models/RestaurantSettings.js';
import Order from '../models/Order.js';
import Bill from '../models/Bill.js';
import Payment from '../models/Payment.js';
import RestaurantState from '../models/RestaurantState.js';
import { migrateLegacyState } from '../services/legacyMigration.js';
import { importLegacyPayload } from '../services/legacyMigration.js';

let replicaSet;
const tokens = {};
let orderId, billId;
before(async () => {
  process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-chars';
  process.env.JWT_EXPIRES_IN = '1h';
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replicaSet.getUri();
  await connectDB();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await Table.create({ id: 'table-a', name: 'Test Table', capacity: 4, status: 'Available', active: true });
  await MenuItem.create({ id: 'food-a', name: 'Test Curry', category: 'Main', price: 100, available: true });
  await RestaurantSettings.create({ key: 'default', name: 'Test Restaurant', gstRate: 0.18, currency: 'INR' });
  for (const role of ['Owner','Manager','Cashier','Waiter','Kitchen Staff']) {
    const user = await User.create({ username: role.toLowerCase(), name: role, role, passwordHash: await bcrypt.hash('test-password-123', 10) });
    if (role === 'Waiter') await StaffProfile.create({ id: user.id, username: user.username, name: user.name, active: true });
    const response = await request(app).post('/api/auth/login').send({ username: role.toLowerCase(), password: 'test-password-123' }).expect(200);
    const sessionCookie = response.headers['set-cookie']?.find(value => value.startsWith('restaurantPosSession='));
    assert.ok(sessionCookie?.includes('HttpOnly'));
    assert.equal(response.body.token, undefined);
    tokens[role] = decodeURIComponent(sessionCookie.match(/restaurantPosSession=([^;]+)/)[1]);
  }
});
after(async () => { await mongoose.disconnect(); await replicaSet?.stop(); });

test('authentication rejects invalid credentials, missing tokens, and role escalation', async () => {
  await request(app).get('/api/health').expect(200).expect(({ body }) => assert.equal(body.database, 'connected'));
  await request(app).post('/api/auth/login').send({ username: 'owner', password: 'wrong-password' }).expect(401);
  await request(app).get('/api/tables').expect(401);
  const expiredToken = jwt.sign({ sub: (await User.findOne({ username: 'owner' })).id }, process.env.JWT_SECRET, { expiresIn: '-1s', issuer: 'restaurant-pos' });
  await request(app).get('/api/tables').set('Authorization', `Bearer ${expiredToken}`).expect(401);
  const invalidInput = await request(app).post('/api/auth/login').send({ username: 'owner', password: 'x'.repeat(129) }).expect(400);
  assert.equal(JSON.stringify(invalidInput.body).includes('x'.repeat(129)), false);
  const roleAttempt=await request(app).post('/api/auth/login').send({ username: 'owner', password: 'test-password-123', role: 'Manager' }).expect(200);
  assert.equal(roleAttempt.body.user.role,'Owner');
  const owner = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokens.Owner}`).expect(200);
  assert.equal(owner.body.user.role, 'Owner');
  await request(app).get('/api/auth/me').set('Cookie', `restaurantPosSession=${tokens.Owner}`).expect(200);
  await request(app).post('/api/users').set('Cookie', `restaurantPosSession=${tokens.Owner}`).set('Origin', 'https://attacker.example').send({ username: 'csrf-user', name: 'CSRF User', role: 'Cashier', password: 'secure-password-123' }).expect(403);
  await User.create({ username: 'logout-check', name: 'Logout Check', role: 'Cashier', passwordHash: await bcrypt.hash('logout-password-123', 10) });
  const logoutLogin = await request(app).post('/api/auth/login').send({ username: 'logout-check', password: 'logout-password-123' }).expect(200);
  const logoutToken = decodeURIComponent(logoutLogin.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${logoutToken}`).expect(200).expect('set-cookie', /restaurantPosSession=;/);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${logoutToken}`).expect(401);
  await request(app).post('/api/auth/login').send({ username: 'owner', password: 'test-password-123', expectedRole: 'Waiter' }).expect(409);
});

test('empty domain collections do not project demo tables or menu items', async () => {
  const table = await Table.findOneAndDelete({ id: 'table-a' });
  const menu = await MenuItem.findOneAndDelete({ id: 'food-a' });
  try {
    const response = await request(app).get('/api/state').set('Authorization', `Bearer ${tokens.Owner}`).expect(200);
    assert.deepEqual(response.body.data.tables, []);
    assert.deepEqual(response.body.data.menuItems, []);
  } finally {
    if (table) await Table.create(table.toObject());
    if (menu) await MenuItem.create(menu.toObject());
  }
});

test('RBAC applies to the four operational roles', async () => {
  await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Waiter}`).send({ name: 'Forbidden' }).expect(403);
  await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Cashier}`).send({ name: 'Forbidden' }).expect(403);
  await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens['Kitchen Staff']}`).send({ name: 'Forbidden' }).expect(403);
  await request(app).post('/api/menu').set('Authorization', `Bearer ${tokens.Waiter}`).send({ name: 'Forbidden Dish', price: 10 }).expect(403);
  await request(app).post('/api/menu').set('Authorization', `Bearer ${tokens.Cashier}`).send({ name: 'Forbidden Dish', price: 10 }).expect(403);
  await request(app).patch('/api/tables/table-a').set('Authorization', `Bearer ${tokens.Waiter}`).send({ active: false }).expect(403);
  await request(app).patch('/api/tables/table-a').set('Authorization', `Bearer ${tokens.Cashier}`).send({ active: false }).expect(403);
  await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Manager}`).send({ name: 'Manager Table', capacity: 3 }).expect(201);
  await request(app).patch('/api/settings').set('Authorization', `Bearer ${tokens.Manager}`).send({ name: 'Manager Settings' }).expect(200);
  await request(app).patch('/api/settings').set('Authorization', `Bearer ${tokens.Manager}`).send({ gstRate: 0.5 }).expect(403);
  await request(app).patch('/api/settings').set('Authorization', `Bearer ${tokens.Owner}`).send({ gstRate: 0.18 }).expect(200);
  await request(app).get('/api/reports/summary').set('Authorization', `Bearer ${tokens.Cashier}`).expect(200);
  await request(app).get('/api/reports/summary').set('Authorization', `Bearer ${tokens.Waiter}`).expect(403);
  const soup = (await request(app).post('/api/menu').set('Authorization', `Bearer ${tokens.Manager}`).send({ name: 'Soup', price: 40 }).expect(201)).body.menuItem;
  await request(app).post('/api/menu').set('Authorization', `Bearer ${tokens.Manager}`).send({ name: 'Bad Price', price: -1 }).expect(400);
  await request(app).patch(`/api/menu/${soup.id}`).set('Authorization', `Bearer ${tokens.Manager}`).send({ available: false }).expect(200);
  await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Waiter}`).send({ orderType: 'Takeaway', items: [{ menuItemId: soup.id, quantity: 1 }] }).expect(400);
  const managerUsers = await request(app).get('/api/users').set('Authorization', `Bearer ${tokens.Manager}`).expect(200);
  assert.equal(managerUsers.body.users.every(user => user.role === 'Waiter'), true);
  await request(app).get('/api/users').set('Authorization', `Bearer ${tokens.Waiter}`).expect(403);
  await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Manager}`).send({ username: 'manager-created-cashier', name: 'Manager Cashier', role: 'Cashier', password: 'secure-password-123' }).expect(403);
  await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Manager}`).send({ username: 'manager-created-kitchen', name: 'Kitchen Staff', role: 'Kitchen Staff', password: 'secure-password-123' }).expect(403);
  await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Manager}`).send({ username: 'manager-created-manager', name: 'Manager Manager', role: 'Manager', password: 'secure-password-123' }).expect(403);
  await request(app).patch(`/api/users/${(await User.findOne({ username: 'cashier' })).id}`).set('Authorization', `Bearer ${tokens.Manager}`).send({ active: false }).expect(403);
  await request(app).patch(`/api/users/${(await User.findOne({ username: 'waiter' })).id}`).set('Authorization', `Bearer ${tokens.Manager}`).send({ password: 'another-secure-password' }).expect(403);
  await request(app).patch(`/api/users/${(await User.findOne({ username: 'manager' })).id}`).set('Authorization', `Bearer ${tokens.Manager}`).send({ role: 'Owner' }).expect(400);
  await request(app).patch('/api/tables/table-a').set('Authorization', `Bearer ${tokens.Manager}`).send({ name: 'Renamed Table', capacity: 6 }).expect(200);
  await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Cashier}`).send({ orderType: 'Takeaway', items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(403);
  await request(app).post('/api/menu').set('Authorization', `Bearer ${tokens['Kitchen Staff']}`).send({ name: 'Forbidden Dish', price: 10 }).expect(403);
  await request(app).get('/api/billing').set('Authorization', `Bearer ${tokens['Kitchen Staff']}`).expect(403);
  await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Waiter}`).send({ orderType: 'Takeaway', items: [] }).expect(400);
  await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Owner}`).send({ name: 'Patio 1', capacity: 4 }).expect(201);
  await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Manager}`).send({ name: ' patio   1 ', capacity: 4 }).expect(409);
  const patio = (await request(app).get('/api/tables').set('Authorization', `Bearer ${tokens.Owner}`).expect(200)).body.tables.find(table => table.name === 'Patio 1');
  await request(app).patch(`/api/tables/${patio.id}`).set('Authorization', `Bearer ${tokens.Manager}`).send({ active: false }).expect(200);
  await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Waiter}`).send({ orderType: 'DineIn', tableId: patio.id, items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(409);
  await request(app).patch(`/api/tables/${patio.id}`).set('Authorization', `Bearer ${tokens.Owner}`).send({ active: true }).expect(200);
  await request(app).patch(`/api/tables/${patio.id}`).set('Authorization', `Bearer ${tokens.Owner}`).send({ active: false }).expect(200);
  await request(app).patch(`/api/tables/${patio.id}`).set('Authorization', `Bearer ${tokens.Owner}`).send({ active: true }).expect(200);
  await request(app).get('/api/audit-events').set('Authorization', `Bearer ${tokens.Cashier}`).expect(403);
  const limitedReport = await request(app).get('/api/reports/summary').set('Authorization', `Bearer ${tokens.Cashier}`).expect(200);
  assert.equal(Object.hasOwn(limitedReport.body, 'items'), false);
  const fullReport = await request(app).get('/api/reports/summary').set('Authorization', `Bearer ${tokens.Manager}`).expect(200);
  assert.equal(Array.isArray(fullReport.body.items), true);
});

test('order creation uses catalog pricing, occupies a table, and rejects invalid transitions', async () => {
  const response = await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Waiter}`).send({ orderType: 'DineIn', tableId: 'table-a', items: [{ menuItemId: 'food-a', name: 'Forged price', unitPrice: 0.01, quantity: 2 }] }).expect(201);
  orderId = response.body.order.id;
  billId = response.body.bill.id;
  assert.equal(response.body.order.items[0].unitPrice, 100);
  assert.equal(response.body.bill.grandTotal, 236);
  await request(app).patch('/api/menu/food-a').set('Authorization', `Bearer ${tokens.Manager}`).send({ price: 150 }).expect(200);
  assert.equal((await Bill.findOne({ id: billId })).items[0].unitPrice, 100);
  await request(app).patch('/api/menu/food-a').set('Authorization', `Bearer ${tokens.Manager}`).send({ price: 100 }).expect(200);
  const table = await request(app).get('/api/tables').set('Authorization', `Bearer ${tokens.Waiter}`).expect(200);
  assert.equal(table.body.tables.find(item => item.id === 'table-a').status, 'Occupied');
  const waiterProjection=await request(app).get('/api/state').set('Authorization',`Bearer ${tokens.Waiter}`).expect(200);
  assert.equal(waiterProjection.body.data.orders.length,1);
  assert.equal(waiterProjection.body.data.bills.length,0);
  assert.equal(waiterProjection.body.data.payments.length,0);
  await request(app).patch('/api/tables/table-a').set('Authorization', `Bearer ${tokens.Manager}`).send({ status: 'Available' }).expect(409);
  await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.Manager}`).send({ status: 'Completed' }).expect(409);
  const { kots } = (await request(app).get('/api/kots').set('Authorization', `Bearer ${tokens.Manager}`).expect(200)).body;
  const kotId = kots.find(kot => kot.orderId === orderId).id;
  await request(app).patch(`/api/kots/${kotId}/status`).set('Authorization', `Bearer ${tokens.Manager}`).send({ status: 'Preparing' }).expect(200);
  await request(app).patch(`/api/kots/${kotId}/status`).set('Authorization', `Bearer ${tokens.Manager}`).send({ status: 'Ready' }).expect(200);
  const kitchenState = (await request(app).get('/api/state').set('Authorization', `Bearer ${tokens['Kitchen Staff']}`).expect(200)).body.data;
  assert.equal(kitchenState.orders.some(item => item.customerPhone !== undefined || item.total !== undefined), false);
  assert.equal(kitchenState.kots.find(item => item.id === kotId).items[0].unitPrice, undefined);
  assert.equal(kitchenState.menuItems[0].price, undefined);
  assert.equal(kitchenState.restaurantSettings.gstNumber, undefined);
  const readyNotifications = await request(app).get('/api/notifications').set('Authorization', `Bearer ${tokens.Waiter}`).expect(200);
  assert.equal(readyNotifications.body.notifications.some(notification => notification.kotId === kotId), true);
  const notification = readyNotifications.body.notifications.find(item => item.kotId === kotId);
  await request(app).patch(`/api/notifications/${notification.id}/read`).set('Authorization', `Bearer ${tokens.Waiter}`).send({}).expect(200);
  await request(app).patch(`/api/kots/${kotId}/status`).set('Authorization', `Bearer ${tokens.Waiter}`).send({ status: 'Served' }).expect(200);
  await request(app).get('/api/audit-events').set('Authorization', `Bearer ${tokens.Manager}`).expect(200);
});

test('Owner creates Kitchen Staff through the existing user API and the account uses existing KOT permissions', async () => {
  const created = await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).send({ username: 'new-kitchen-user', name: 'New Kitchen Employee', role: 'Kitchen Staff', password: 'temporary-kitchen-password' }).expect(201);
  assert.equal(created.body.user.role, 'Kitchen Staff');
  assert.equal(created.body.user.active, true);
  assert.equal(created.body.user.passwordHash, undefined);
  const storedUser = await User.findOne({ username: 'new-kitchen-user' }).select('+passwordHash');
  assert.notEqual(storedUser.passwordHash, 'temporary-kitchen-password');
  assert.equal(await bcrypt.compare('temporary-kitchen-password', storedUser.passwordHash), true);
  const ownerStaffList = await request(app).get('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).expect(200);
  assert.ok(ownerStaffList.body.users.some(user => user.id === created.body.user.id && user.role === 'Kitchen Staff' && user.active));

  const login = await request(app).post('/api/auth/login').send({ username: 'new-kitchen-user', password: 'temporary-kitchen-password', expectedRole: 'Kitchen Staff' }).expect(200);
  assert.equal(login.body.user.role, 'Kitchen Staff');
  const token = decodeURIComponent(login.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  const order = (await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Owner}`).send({ orderType: 'Takeaway', items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(201)).body.order;
  const kot = (await request(app).get('/api/kots').set('Authorization', `Bearer ${token}`).expect(200)).body.kots.find(item => item.orderId === order.id);
  assert.ok(kot);
  await request(app).patch(`/api/kots/${kot.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Preparing' }).expect(200);
  await request(app).patch(`/api/kots/${kot.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Ready' }).expect(200);
  await request(app).patch(`/api/kots/${kot.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'Served' }).expect(403);
  await request(app).get('/api/billing').set('Authorization', `Bearer ${token}`).expect(403);
});

test('Owner creates Manager accounts with bcrypt credentials while Waiter creation and role permissions remain intact', async () => {
  const created = await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).send({ username: 'new-manager-user', name: 'New Manager Employee', role: 'Manager', password: 'temporary-manager-password' }).expect(201);
  assert.equal(created.body.user.role, 'Manager');
  assert.equal(created.body.user.active, true);
  assert.equal(created.body.user.passwordHash, undefined);
  const storedUser = await User.findOne({ username: 'new-manager-user' }).select('+passwordHash');
  assert.notEqual(storedUser.passwordHash, 'temporary-manager-password');
  assert.equal(await bcrypt.compare('temporary-manager-password', storedUser.passwordHash), true);
  const listed = await request(app).get('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).expect(200);
  assert.ok(listed.body.users.some(user => user.id === created.body.user.id && user.role === 'Manager' && user.active));
  await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).send({ username: 'new-manager-user', name: 'Duplicate Manager', role: 'Manager', password: 'another-temporary-password' }).expect(409);

  const login = await request(app).post('/api/auth/login').send({ username: 'new-manager-user', password: 'temporary-manager-password', expectedRole: 'Manager' }).expect(200);
  assert.equal(login.body.user.role, 'Manager');
  const token = decodeURIComponent(login.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  await request(app).get('/api/tables').set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).get('/api/reports/summary').set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).post('/api/users').set('Authorization', `Bearer ${token}`).send({ username: 'manager-cannot-create-manager', name: 'Not Allowed', role: 'Manager', password: 'temporary-manager-password' }).expect(403);
  await request(app).post('/api/users').set('Authorization', `Bearer ${token}`).send({ username: 'manager-cannot-create-kitchen', name: 'Not Allowed', role: 'Kitchen Staff', password: 'temporary-manager-password' }).expect(403);
  const settings = await request(app).get('/api/settings').set('Authorization', `Bearer ${token}`).expect(200);
  assert.equal(settings.body.settings.gstRate, undefined);
  assert.equal(settings.body.settings.currency, undefined);

  const waiter = await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).send({ username: 'waiter-regression-user', name: 'Waiter Regression', role: 'Waiter', password: 'temporary-waiter-password' }).expect(201);
  assert.equal(waiter.body.user.role, 'Waiter');
  assert.equal((await StaffProfile.findOne({ username: 'waiter-regression-user' })).active, true);
  await request(app).post('/api/auth/login').send({ username: 'waiter-regression-user', password: 'temporary-waiter-password', expectedRole: 'Waiter' }).expect(200);
});

test('billing discount and idempotent payment are transactional', async () => {
  await request(app).patch(`/api/billing/${orderId}/discount`).set('Authorization', `Bearer ${tokens.Cashier}`).send({ discount: 10 }).expect(200);
  const bill = await Bill.findOne({ id: billId });
  assert.equal(bill.grandTotal, 224.2);
  const paymentBody = { amountApplied: 224.2, tipAmount: 5, method: 'Cash', cashTendered: 235 };
  const payment = await request(app).post(`/api/billing/${orderId}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'payment-request-0001').send(paymentBody).expect(201);
  const retry = await request(app).post(`/api/billing/${orderId}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'payment-request-0001').send(paymentBody).expect(200);
  assert.equal(retry.body.payment.id, payment.body.payment.id);
  await request(app).post(`/api/billing/${orderId}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'payment-request-0001').send({ ...paymentBody, amountApplied: 200 }).expect(409);
  assert.equal(await Payment.countDocuments({ billId }), 1);
  await request(app).get(`/api/payments?orderId=${orderId}`).set('Authorization', `Bearer ${tokens.Cashier}`).expect(200);
  await request(app).get('/api/payments?status[$ne]=Completed').set('Authorization', `Bearer ${tokens.Cashier}`).expect(400);
  await request(app).post(`/api/billing/${orderId}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'payment-request-0002').send({ ...paymentBody, amountApplied: 1 }).expect(409);
  await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.Manager}`).send({ status: 'Completed' }).expect(200);
});

test('concurrent dine-in orders cannot claim one table and parallel payments cannot over-collect', async () => {
  const table = (await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Owner}`).send({ name: 'Concurrency Table', capacity: 4 }).expect(201)).body.table;
  const makeOrder = () => request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Manager}`).send({ orderType: 'DineIn', tableId: table.id, items: [{ menuItemId: 'food-a', quantity: 1 }] });
  const orderResponses = await Promise.all([makeOrder(), makeOrder()]);
  assert.deepEqual(orderResponses.map(response => response.status).sort(), [201, 409]);
  assert.equal(await Order.countDocuments({ tableId: table.id, status: { $in: ['Open','In Progress'] } }), 1);
  const order = (await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Owner}`).send({ orderType: 'Takeaway', items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(201)).body.order;
  const bill = await Bill.findOne({ orderId: order.id });
  const submit = key => request(app).post(`/api/billing/${order.id}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', key).send({ amountApplied: bill.grandTotal, method: 'UPI' });
  const paymentResponses = await Promise.all([submit('concurrent-payment-0001'), submit('concurrent-payment-0002')]);
  assert.deepEqual(paymentResponses.map(response => response.status).sort(), [201, 409]);
  assert.equal(await Payment.countDocuments({ orderId: order.id, status: 'Completed' }), 1);
});

test('partial payments retain balances, settle only at the exact total, and waiter item additions stay assigned', async () => {
  const waiterOrder = (await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Waiter}`).send({ orderType: 'Takeaway', items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(201)).body.order;
  const waiterAddition = await request(app).post(`/api/orders/${waiterOrder.id}/items`).set('Authorization', `Bearer ${tokens.Waiter}`).send({ items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(201);
  assert.equal(waiterAddition.body.kot.sequence, 2);
  const order = (await request(app).post('/api/orders').set('Authorization', `Bearer ${tokens.Owner}`).send({ orderType: 'Takeaway', items: [{ menuItemId: 'food-a', quantity: 1 }] }).expect(201)).body.order;
  const bill = await Bill.findOne({ orderId: order.id });
  await request(app).post(`/api/billing/${order.id}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'partial-payment-0001').send({ amountApplied: 50, method: 'UPI', mode: 'Full' }).expect(201);
  assert.equal((await Bill.findOne({ orderId: order.id })).status, 'Open');
  assert.equal((await Order.findOne({ id: order.id })).paymentStatus, 'Partially Paid');
  const final = await request(app).post(`/api/billing/${order.id}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'partial-payment-0002').send({ amountApplied: bill.grandTotal - 50, method: 'UPI', mode: 'Partial' }).expect(201);
  assert.equal(final.body.payment.mode, 'Full');
  assert.equal((await Bill.findOne({ orderId: order.id })).status, 'Settled');
  await request(app).post(`/api/billing/${order.id}/payments`).set('Authorization', `Bearer ${tokens.Cashier}`).set('Idempotency-Key', 'partial-payment-0003').send({ amountApplied: 1, method: 'UPI' }).expect(409);
});

test('database data remains available after reconnecting', async () => {
  await mongoose.disconnect();
  await request(app).get('/api/health').expect(503).expect(({ body }) => assert.equal(body.database, 'disconnected'));
  await connectDB();
  await request(app).get('/api/health').expect(200).expect(({ body }) => assert.equal(body.database, 'connected'));
  assert.equal(await Order.countDocuments({ id: orderId }), 1);
  assert.equal(await Payment.countDocuments({ billId }), 1);
  const bills = await request(app).get('/api/billing').set('Authorization', `Bearer ${tokens.Cashier}`).expect(200);
  assert.equal(bills.body.bills.find(item => item.id === billId).status, 'Settled');
});

test('owner table and menu records persist through API reload and database reconnect', async () => {
  const table = (await request(app).post('/api/tables').set('Authorization', `Bearer ${tokens.Owner}`).send({ name: 'Persistence Check Table', capacity: 5 }).expect(201)).body.table;
  const menuItem = (await request(app).post('/api/menu').set('Authorization', `Bearer ${tokens.Owner}`).send({ name: 'Persistence Check Item', price: 123.45, category: 'Test' }).expect(201)).body.menuItem;
  const tablesBeforeReconnect = (await request(app).get('/api/tables').set('Authorization', `Bearer ${tokens.Owner}`).expect(200)).body.tables;
  const menuBeforeReconnect = (await request(app).get('/api/menu').set('Authorization', `Bearer ${tokens.Owner}`).expect(200)).body.menuItems;
  assert.ok(tablesBeforeReconnect.some(item => item.id === table.id));
  assert.ok(menuBeforeReconnect.some(item => item.id === menuItem.id));

  await mongoose.disconnect();
  await connectDB();
  const tablesAfterReconnect = (await request(app).get('/api/tables').set('Authorization', `Bearer ${tokens.Owner}`).expect(200)).body.tables;
  const menuAfterReconnect = (await request(app).get('/api/menu').set('Authorization', `Bearer ${tokens.Owner}`).expect(200)).body.menuItems;
  assert.ok(tablesAfterReconnect.some(item => item.id === table.id));
  assert.ok(menuAfterReconnect.some(item => item.id === menuItem.id));
});

test('additional items create a KOT and item cancellation recalculates the bill transactionally', async () => {
  const created=await request(app).post('/api/orders').set('Authorization',`Bearer ${tokens.Owner}`).send({orderType:'Takeaway',items:[{menuItemId:'food-a',quantity:2}]}).expect(201);
  const extra=await request(app).post(`/api/orders/${created.body.order.id}/items`).set('Authorization',`Bearer ${tokens.Manager}`).send({items:[{menuItemId:'food-a',quantity:1}]}).expect(201);
  assert.equal(extra.body.kot.sequence,2);
  const firstKot=created.body.kot;
  const cancelled=await request(app).post(`/api/kots/${firstKot.id}/items/${firstKot.items[0].lineId}/cancellations`).set('Authorization',`Bearer ${tokens.Manager}`).send({quantity:1,reason:'Guest changed order'}).expect(200);
  assert.equal(cancelled.body.bill.subtotal,200);
  assert.equal(cancelled.body.bill.grandTotal,236);
});

test('legacy state migration copies records without deleting its source document', async () => {
  const legacy = await RestaurantState.create({ key: 'default', revision: 4, data: { tables: [{ id: 'legacy-table', status: 'Available' }], menuItems: [{ id: 'legacy-menu', name: 'Legacy Dish', price: 77, available: true }], orders: [], kots: [], bills: [], payments: [], auditEvents: [], notifications: [], waiters: [], restaurantSettings: { name: 'Preserved Restaurant', currency: 'INR' } } });
  const outcome = await migrateLegacyState();
  assert.equal(outcome.migrated, true);
  assert.equal(outcome.counts.tables, 1);
  assert.equal((await RestaurantState.findById(legacy._id)).data.menuItems[0].name, 'Legacy Dish');
  assert.equal((await RestaurantState.findOne({ key: 'default' })).data.migration.status, 'complete');
  assert.equal((await Table.findOne({ id: 'legacy-table' })).name, 'Table legacy-table');
  assert.equal((await MenuItem.findOne({ id: 'legacy-menu' })).price, 77);
  assert.equal((await migrateLegacyState()).migrated, false);
  assert.equal(await Table.countDocuments({ id: 'legacy-table' }), 1);
});

test('failed legacy migration rolls back earlier collection writes and leaves its source retryable', async () => {
  const data = { tables: [{ id: 'rollback-table', name: 'Rollback Table', capacity: 4, active: true, status: 'Available' }], payments: [
    { id: 'rollback-payment-a', idempotencyKey: 'rollback-duplicate-key', orderId: 'rollback-order', billId: 'rollback-bill', method: 'Cash', amount: 1, status: 'Completed' },
    { id: 'rollback-payment-b', idempotencyKey: 'rollback-duplicate-key', orderId: 'rollback-order', billId: 'rollback-bill', method: 'Cash', amount: 1, status: 'Completed' }
  ] };
  await RestaurantState.updateOne({ key: 'default' }, { $set: { 'data.tables': data.tables, 'data.payments': data.payments }, $unset: { 'data.migration': 1 } });
  await assert.rejects(migrateLegacyState());
  assert.equal(await Table.exists({ id: 'rollback-table' }), null);
  assert.equal((await RestaurantState.findOne({ key: 'default' })).data.migration, undefined);
});

test('owner browser import replaces bootstrap seeds, preserves real database settings, and retains imported source records', async () => {
  await Table.create({ id: 'seed-table', name: 'Table 1', capacity: 4, status: 'Available', active: true, seededDefault: true });
  await MenuItem.create({ id: 'seed-menu', name: 'Chicken Biryani', price: 250, available: true, seededDefault: true });
  const imported = await importLegacyPayload({ tables: [{ id: 'seed-table', name: 'Patio 1', status: 'Reserved', capacity: 8 }], menuItems: [{ id: 'seed-menu', name: 'House Biryani', price: 310, available: true }], orders: [], kots: [], bills: [], payments: [], auditEvents: [], notifications: [], waiters: [], restaurantSettings: { name: 'Legacy Name', currency: 'USD' } });
  assert.equal(imported.counts.tables, 1);
  assert.equal((await Table.findOne({ id: 'seed-table' })).name, 'Patio 1');
  assert.equal((await MenuItem.findOne({ id: 'seed-menu' })).price, 310);
  assert.equal((await RestaurantSettings.findOne({ key: 'default' })).name, 'Manager Settings');
  await request(app).post('/api/migration/browser-state').set('Authorization',`Bearer ${tokens.Manager}`).send({data:{tables:[]}}).expect(403);
  await request(app).post('/api/migration/browser-state').set('Authorization',`Bearer ${tokens.Owner}`).send({data:{tables:[],menuItems:[],orders:[],kots:[],bills:[],payments:[],auditEvents:[],notifications:[],waiters:[]}}).expect(200);
});

test('owner browser import accepts legacy records with their original timestamps', async () => {
  const createdAt = new Date('2025-03-04T05:06:07.000Z');
  const updatedAt = new Date('2025-03-05T06:07:08.000Z');
  await importLegacyPayload({
    tables: [{ id: 'timestamp-import-table', name: 'Timestamp Import Table', capacity: 4, active: true, status: 'Available', createdAt, updatedAt }],
    menuItems: [], orders: [], kots: [], bills: [], payments: [], auditEvents: [], notifications: [], waiters: []
  });
  const imported = await Table.findOne({ id: 'timestamp-import-table' });
  assert.equal(imported.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(imported.updatedAt.toISOString(), updatedAt.toISOString());
});

test('user provisioning hashes passwords and inactive users lose existing sessions', async () => {
  const response = await request(app).post('/api/users').set('Authorization', `Bearer ${tokens.Owner}`).send({ username: 'temp-cashier', name: 'Temporary Cashier', role: 'Cashier', password: 'new-secure-password' }).expect(201);
  assert.equal(response.body.user.passwordHash, undefined);
  const initialLogin = await request(app).post('/api/auth/login').send({ username: 'temp-cashier', password: 'new-secure-password' }).expect(200);
  const token = decodeURIComponent(initialLogin.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  await request(app).patch(`/api/users/${response.body.user.id}`).set('Authorization', `Bearer ${tokens.Owner}`).send({ active: false }).expect(200);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  await request(app).post('/api/auth/login').send({ username: 'temp-cashier', password: 'new-secure-password' }).expect(401);
  await request(app).patch(`/api/users/${response.body.user.id}`).set('Authorization', `Bearer ${tokens.Owner}`).send({ active: true }).expect(200);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  const renewedResponse = await request(app).post('/api/auth/login').send({ username: 'temp-cashier', password: 'new-secure-password' }).expect(200);
  const renewedToken = decodeURIComponent(renewedResponse.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  await request(app).patch(`/api/users/${response.body.user.id}`).set('Authorization', `Bearer ${tokens.Owner}`).send({ password: 'changed-password-456' }).expect(200);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${renewedToken}`).expect(401);
  await request(app).post('/api/auth/login').send({ username: 'temp-cashier', password: 'changed-password-456' }).expect(200);
});

test('staff password reset enforces role boundaries, validates passwords, audits and invalidates sessions', async () => {
  const resettableRoles = ['Manager', 'Cashier', 'Waiter', 'Kitchen Staff'];
  const targets = {};
  for (const role of resettableRoles) {
    targets[role] = await User.create({
      username: `reset-${role.toLowerCase().replaceAll(' ', '-')}`,
      name: `Reset ${role}`,
      role,
      passwordHash: await bcrypt.hash('old-password-123', 10)
    });
  }
  const ownerAccount = await User.findOne({ username: 'owner' });
  const ownerList = await request(app).get('/api/staff/password-reset').set('Authorization', `Bearer ${tokens.Owner}`).expect(200);
  assert.ok(ownerList.body.users.some(user => user.id === targets.Manager.id));
  assert.equal(ownerList.body.users.some(user => user.id === ownerAccount.id), false);
  assert.equal(ownerList.body.users.some(user => user.passwordHash !== undefined), false);

  const managerList = await request(app).get('/api/staff/password-reset').set('Authorization', `Bearer ${tokens.Manager}`).expect(200);
  assert.ok(managerList.body.users.some(user => user.id === targets.Waiter.id));
  assert.ok(managerList.body.users.some(user => user.id === targets.Cashier.id));
  assert.ok(managerList.body.users.some(user => user.id === targets['Kitchen Staff'].id));
  assert.equal(managerList.body.users.some(user => user.role === 'Manager' || user.role === 'Owner'), false);
  await request(app).get('/api/staff/password-reset').set('Authorization', `Bearer ${tokens.Cashier}`).expect(403);
  await request(app).get('/api/staff/password-reset').set('Authorization', `Bearer ${tokens.Waiter}`).expect(403);
  await request(app).get('/api/staff/password-reset').set('Authorization', `Bearer ${tokens['Kitchen Staff']}`).expect(403);

  const resetPath = id => `/api/users/${id}/password`;
  await request(app).patch(resetPath(targets.Manager.id)).set('Authorization', `Bearer ${tokens.Manager}`).send({ password: 'manager-cannot-reset', confirmPassword: 'manager-cannot-reset' }).expect(403);
  await request(app).patch(resetPath(ownerAccount.id)).set('Authorization', `Bearer ${tokens.Manager}`).send({ password: 'manager-cannot-reset', confirmPassword: 'manager-cannot-reset' }).expect(403);
  await request(app).patch(resetPath(targets.Waiter.id)).set('Authorization', `Bearer ${tokens.Cashier}`).send({ password: 'cashier-cannot-reset', confirmPassword: 'cashier-cannot-reset' }).expect(403);
  await request(app).patch(resetPath(targets.Waiter.id)).set('Authorization', `Bearer ${tokens.Waiter}`).send({ password: 'waiter-cannot-reset', confirmPassword: 'waiter-cannot-reset' }).expect(403);
  await request(app).patch(resetPath(targets.Waiter.id)).set('Authorization', `Bearer ${tokens['Kitchen Staff']}`).send({ password: 'kitchen-cannot-reset', confirmPassword: 'kitchen-cannot-reset' }).expect(403);
  await request(app).patch(resetPath(targets.Cashier.id)).set('Authorization', `Bearer ${tokens.Owner}`).send({ password: 'short', confirmPassword: 'short' }).expect(400);
  await request(app).patch(resetPath(targets.Cashier.id)).set('Authorization', `Bearer ${tokens.Owner}`).send({ password: 'valid-password', confirmPassword: 'different-password' }).expect(400);

  const oldLogin = await request(app).post('/api/auth/login').send({ username: targets.Manager.username, password: 'old-password-123' }).expect(200);
  const oldToken = decodeURIComponent(oldLogin.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  const ownerReset = await request(app).patch(resetPath(targets.Manager.id)).set('Authorization', `Bearer ${tokens.Owner}`).send({ password: 'owner-reset-password', confirmPassword: 'owner-reset-password' }).expect(200);
  assert.equal(ownerReset.body.user.passwordHash, undefined);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`).expect(401);
  await request(app).post('/api/auth/login').send({ username: targets.Manager.username, password: 'old-password-123' }).expect(401);
  const newLogin = await request(app).post('/api/auth/login').send({ username: targets.Manager.username, password: 'owner-reset-password' }).expect(200);
  const newToken = decodeURIComponent(newLogin.headers['set-cookie'][0].match(/restaurantPosSession=([^;]+)/)[1]);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${newToken}`).expect(200)).body.user.role, 'Manager');
  const managerHash = await User.findById(targets.Manager._id).select('+passwordHash');
  assert.notEqual(managerHash.passwordHash, 'owner-reset-password');
  assert.equal(await bcrypt.compare('owner-reset-password', managerHash.passwordHash), true);

  for (const role of ['Waiter', 'Cashier', 'Kitchen Staff']) {
    await request(app).patch(resetPath(targets[role].id)).set('Authorization', `Bearer ${tokens.Manager}`).send({ password: `manager-reset-${role}`, confirmPassword: `manager-reset-${role}` }).expect(200);
    assert.equal(await request(app).post('/api/auth/login').send({ username: targets[role].username, password: `manager-reset-${role}` }).then(response => response.status), 200);
  }
  const audit = await StaffAuditEvent.find({ targetUserId: String(targets.Manager._id) }).lean();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorUserId, String(ownerAccount._id));
  assert.equal(audit[0].action, 'staff_password_reset');
  assert.ok(audit[0].createdAt instanceof Date);
  assert.equal(Object.keys(audit[0]).some(key => /password|hash/i.test(key)), false);
});
