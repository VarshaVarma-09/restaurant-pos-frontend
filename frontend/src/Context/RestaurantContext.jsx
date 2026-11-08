import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getStoredUser, hasPermission } from "../auth/permissions";
import { getCompletedPaymentTotal } from "../utils/payments";
import { apiRequest } from "../api";

const RestaurantContext = createContext(null);

const GST_RATE = 0.18;
const ACTIVE_ORDER_STATUSES = ["Open", "In Progress"];

function moneyToCents(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100);
}

function centsToMoney(cents) {
    return cents / 100;
}

function roundMoney(amount) {
    return centsToMoney(moneyToCents(amount));
}

function createId(prefix) {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
    return new Date().toISOString();
}

function loadSavedRestaurantState() {
    // Browser storage is reserved for authentication only. Business data comes from MongoDB.
    return {};
}

function normalizeItems(items = [], menuCatalog = []) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("At least one item is required.");
    }

    return items.map((item, index) => {
        if (!item || typeof item !== "object") {
            throw new Error(`Item ${index + 1} must be a valid item.`);
        }

        if (typeof item.name !== "string" || item.name.trim() === "") {
            throw new Error(`Item ${index + 1} must have a name.`);
        }

        const rawUnitPrice = item.unitPrice ?? item.price;
        if ((typeof rawUnitPrice !== "number" && typeof rawUnitPrice !== "string") ||
            (typeof rawUnitPrice === "string" && rawUnitPrice.trim() === "")) {
            throw new Error(`Item ${index + 1} must have a unit price.`);
        }

        const parsedUnitPrice = Number(rawUnitPrice);
        if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) {
            throw new Error(`Item ${index + 1} must have a finite, non-negative unit price.`);
        }

        const unitPrice = roundMoney(parsedUnitPrice);
        if (!Number.isFinite(unitPrice)) {
            throw new Error(`Item ${index + 1} unit price is outside the supported range.`);
        }

        const rawQuantity = item.quantity;
        if ((typeof rawQuantity !== "number" && typeof rawQuantity !== "string") ||
            (typeof rawQuantity === "string" && rawQuantity.trim() === "")) {
            throw new Error(`Item ${index + 1} must have a positive integer quantity.`);
        }

        const quantity = Number(rawQuantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new Error(`Item ${index + 1} must have a positive integer quantity.`);
        }

        if (!Number.isSafeInteger(moneyToCents(unitPrice * quantity))) {
            throw new Error(`Item ${index + 1} total is outside the supported monetary range.`);
        }

        const name = item.name.trim();

        return {
            lineId: item.lineId ?? createId("kot_item"),
            menuItemId: item.menuItemId ?? item.id ??
                menuCatalog.find(menuItem => menuItem.name === name)?.id ?? null,
            name,
            unitPrice,
            quantity,
            notes: item.notes ?? "",
            category: item.category ?? menuCatalog.find(menuItem =>
                (item.menuItemId ?? item.id) != null
                    ? String(menuItem.id) === String(item.menuItemId ?? item.id)
                    : menuItem.name === name
            )?.category ?? ""
        };
    });
}

function calculateBillTotals(items, discount = 0, taxRate = GST_RATE) {
    const subtotalCents = items.reduce(
        (sum, item) => sum + moneyToCents(item.unitPrice * item.quantity),
        0
    );

    const normalizedDiscountCents = moneyToCents(discount);

    if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(normalizedDiscountCents)) {
        throw new Error("Bill totals exceed the supported monetary range.");
    }

    const taxableAmountCents = Math.max(0, subtotalCents - normalizedDiscountCents);
    const normalizedTaxRate = Number(taxRate);
    if (!Number.isFinite(normalizedTaxRate) || normalizedTaxRate < 0 || normalizedTaxRate > 1) {
        throw new Error("GST rate must be between 0% and 100%.");
    }
    const taxAmountCents = Math.round(taxableAmountCents * normalizedTaxRate);
    const grandTotalCents = Math.max(0, taxableAmountCents + taxAmountCents);

    if (!Number.isSafeInteger(grandTotalCents)) {
        throw new Error("Bill totals exceed the supported monetary range.");
    }

    return {
        subtotal: centsToMoney(subtotalCents),
        discount: centsToMoney(normalizedDiscountCents),
        taxRate: normalizedTaxRate,
        taxAmount: centsToMoney(taxAmountCents),
        grandTotal: centsToMoney(grandTotalCents)
    };
}

function getBillableItems(orderKots) {
    return orderKots
        .filter(kot => kot.status !== "Cancelled")
        .flatMap(kot => kot.items.map(item => ({
            ...item,
            quantity: Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0))
        })).filter(item => item.quantity > 0));
}

function getActorSnapshot(user = getStoredUser()) {
    return user ? {
        userId: user.id,
        name: user.name || user.username,
        role: user.role
    } : null;
}

function getPaymentStatus(paidAmount, grandTotal) {
    const paidCents = moneyToCents(paidAmount);
    const totalCents = moneyToCents(grandTotal);

    if (totalCents === 0 && paidCents === 0) {
        return "Paid";
    }

    if (paidCents <= 0) {
        return "Unpaid";
    }

    return paidCents >= totalCents ? "Paid" : "Partially Paid";
}

function createReadyKotNotification(kot, order, assignedWaiter, timestamp) {
    const sequence = kot.sequence ?? kot.kotNumber ?? 1;
    const location = order.orderType === "DineIn"
        ? `Table ${order.tableId ?? order.table ?? "Unassigned"}`
        : "Takeaway";
    return {
        id: `notification_ready_${kot.id}`,
        recipientUserId: assignedWaiter?.userId ?? null,
        recipientName: assignedWaiter?.name ?? null,
        orderId: order.id,
        kotId: kot.id,
        orderNumber: order.orderNumber ?? order.id,
        kotSequence: sequence,
        orderType: order.orderType,
        tableId: order.orderType === "DineIn" ? order.tableId ?? order.table ?? null : null,
        items: (kot.items || []).map(item => ({
            name: item.name,
            quantity: Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0)),
            notes: item.notes || ""
        })).filter(item => item.quantity > 0),
        title: assignedWaiter ? `KOT #${sequence} ready` : `Unassigned KOT #${sequence} ready`,
        message: `Order #${order.orderNumber ?? order.id} · ${location}`,
        type: assignedWaiter ? "kot_ready" : "unassigned_kot_ready",
        createdAt: timestamp,
        readAt: null
    };
}

export function RestaurantProvider({ children }) {
    const [savedState] = useState(loadSavedRestaurantState);
    const [storageError, setStorageError] = useState(savedState.storageError ?? null);
    const [tables, setTablesState] = useState(() => savedState.tables ?? []);

    const [restaurantSettings, setRestaurantSettingsState] = useState(() => ({
        name: "My Restaurant",
        phone: "",
        address: "",
        gstNumber: "",
        gstRate: GST_RATE,
        currency: "INR",
        receiptFooter: "",
        ...(savedState.restaurantSettings ?? {})
    }));

    const [orders, setOrdersState] = useState(() => savedState.orders ?? []);
    const [kots, setKotsState] = useState(() => savedState.kots ?? []);
    const [bills, setBillsState] = useState(() => savedState.bills ?? []);
    const [payments, setPaymentsState] = useState(() => savedState.payments ?? []);
    const [auditEvents, setAuditEventsState] = useState(() => savedState.auditEvents ?? []);
    const [waiters, setWaitersState] = useState(() => savedState.waiters ?? []);
    const [kitchenStaff, setKitchenStaff] = useState([]);
    const [managerAccounts, setManagerAccounts] = useState([]);
    const [roundRobinPointer, setRoundRobinPointerState] = useState(() => savedState.roundRobinPointer ?? 0);
    const [notifications, setNotificationsState] = useState(() => savedState.notifications ?? []);

    const [menuItems, setMenuItemsState] = useState(() => savedState.menuItems ?? []);
    const [remoteStateReady, setRemoteStateReady] = useState(false);
    const [remoteStateError, setRemoteStateError] = useState(null);
    const [remoteRetryCount, setRemoteRetryCount] = useState(0);

    const stateSnapshotRef = useRef({
        tables, orders, kots, bills, payments, auditEvents, menuItems,
        restaurantSettings, waiters, roundRobinPointer, notifications
    });
    const mutationDraftRef = useRef(null);
    const stateSetters = {
        tables: setTablesState,
        orders: setOrdersState,
        kots: setKotsState,
        bills: setBillsState,
        payments: setPaymentsState,
        auditEvents: setAuditEventsState,
        menuItems: setMenuItemsState,
        restaurantSettings: setRestaurantSettingsState,
        waiters: setWaitersState,
        roundRobinPointer: setRoundRobinPointerState,
        notifications: setNotificationsState
    };

    function updateDraftState(key, update) {
        const draft = mutationDraftRef.current;
        if (!draft) throw new Error("Restaurant changes must use a validated Context action.");
        draft[key] = typeof update === "function" ? update(draft[key]) : update;
    }

    const setTables = update => updateDraftState("tables", update);
    const setOrders = update => updateDraftState("orders", update);
    const setKots = update => updateDraftState("kots", update);
    const setBills = update => updateDraftState("bills", update);
    const setPayments = update => updateDraftState("payments", update);
    const setAuditEvents = update => updateDraftState("auditEvents", update);
    const setMenuItems = update => updateDraftState("menuItems", update);
    const setRestaurantSettings = update => updateDraftState("restaurantSettings", update);
    const setWaiters = update => updateDraftState("waiters", update);
    const setRoundRobinPointer = update => updateDraftState("roundRobinPointer", update);
    const setNotifications = update => updateDraftState("notifications", update);

    async function refreshRemoteState() {
        const { data } = await apiRequest('/state');
        // The server is now authoritative, so discard the obsolete combined browser business-state key.
        try { globalThis.localStorage?.removeItem("restaurantPosState"); }
        catch { /* The app continues with the state returned by the backend. */ }
        const merged = { ...stateSnapshotRef.current, ...data };
        stateSnapshotRef.current = merged;
        Object.entries(stateSetters).forEach(([key, setter]) => { if (merged[key] !== undefined) setter(merged[key]); });
        setStorageError(null);
        setRemoteStateError(null);
        setRemoteStateReady(true);
        return merged;
    }

    useEffect(() => {
        let active = true;
        const loadRemoteState = async () => {
            try {
                if (!active) return;
                setRemoteStateReady(false);
                setRemoteStateError(null);
                const session = await apiRequest('/auth/me');
                if (!active) return;
                await refreshRemoteState();
                if (session.user?.role === 'Owner') {
                    const { users = [] } = await apiRequest('/users');
                    if (active) {
                        setKitchenStaff(users.filter(account => account.role === 'Kitchen Staff'));
                        setManagerAccounts(users.filter(account => account.role === 'Manager'));
                    }
                }
            } catch (error) {
                if (active) {
                    const endpoint = error.apiPath ? `${error.apiMethod} ${error.apiPath}` : 'restaurant data API';
                    setRemoteStateError(error.status === 401
                        ? `Your session could not be verified while loading ${endpoint}. Sign in again.`
                        : `Could not load server data via ${endpoint}. ${error.message || 'Check the API connection and try again.'}`);
                    setRemoteStateReady(true);
                }
            }
        };
        globalThis.addEventListener?.('restaurant-auth-change', loadRemoteState);
        loadRemoteState();
        return () => { active = false; globalThis.removeEventListener?.('restaurant-auth-change', loadRemoteState); };
    // Initial state is loaded once per authenticated session; the event handles sign in/out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remoteRetryCount]);

    // eslint-disable-next-line no-unused-vars
    function addWaiterAccount(input = {}) {
        const { username, name } = input;
        requirePermission("waiters:manage");
        const normalizedUsername = String(username || "").trim();
        const normalizedName = String(name || "").trim();
        if (!normalizedUsername || !normalizedName) throw new Error("Waiter username and employee name are required.");
        if (waiters.some(waiter => waiter.username.trim().toLowerCase() === normalizedUsername.toLowerCase())) {
            throw new Error("A Waiter account with this username already exists.");
        }
        const timestamp = now();
        const waiter = {
            id: input.id ?? createId("waiter"),
            username: normalizedUsername,
            name: normalizedName,
            role: "Waiter",
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        setWaiters(previous => [...previous, waiter]);
        return waiter;
    }

    // eslint-disable-next-line no-unused-vars
    function addRestaurantTable({ name, capacity }) {
        requirePermission("tables:manage");
        const normalizedName = String(name || "").trim();
        const normalizedCapacity = Number(capacity);
        if (!normalizedName || !Number.isSafeInteger(normalizedCapacity) || normalizedCapacity < 1 || normalizedCapacity > 50) {
            throw new Error("Enter a table name and a capacity between 1 and 50.");
        }
        const table = { id: createId("table"), name: normalizedName, capacity: normalizedCapacity, status: "Available", active: true, createdAt: now() };
        setTables(previous => [...previous, table]);
        return table;
    }

    // eslint-disable-next-line no-unused-vars
    function updateRestaurantTable(tableId, changes = {}) {
        requirePermission("tables:manage");
        const table = tables.find(item => String(item.id) === String(tableId));
        if (!table) throw new Error("Table not found.");
        const name = String(changes.name ?? table.name ?? "").trim();
        const capacity = Number(changes.capacity ?? table.capacity);
        if (!name || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 50) {
            throw new Error("Enter a table name and a capacity between 1 and 50.");
        }
        setTables(previous => previous.map(item => String(item.id) === String(tableId)
            ? { ...item, name, capacity, updatedAt: now() }
            : item
        ));
    }

    // eslint-disable-next-line no-unused-vars
    function setRestaurantTableStatus(tableId, status) {
        requirePermission("tables:manage");
        if (!["Available", "Occupied", "Reserved"].includes(status)) throw new Error("Invalid table status.");
        const table = tables.find(item => String(item.id) === String(tableId));
        if (!table) throw new Error("Table not found.");
        const hasActiveOrder = orders.some(order => ACTIVE_ORDER_STATUSES.includes(order.status) &&
            order.orderType === "DineIn" && String(order.tableId ?? order.table) === String(tableId));
        if (hasActiveOrder && status !== "Occupied") throw new Error("A table with an active dine-in order must remain Occupied.");
        setTables(previous => previous.map(item => String(item.id) === String(tableId)
            ? { ...item, status, updatedAt: now() }
            : item
        ));
    }

    // eslint-disable-next-line no-unused-vars
    function toggleRestaurantTableActive(tableId) {
        requirePermission("tables:manage");
        const table = tables.find(item => String(item.id) === String(tableId));
        if (!table) throw new Error("Table not found.");
        const hasActiveOrder = orders.some(order => ACTIVE_ORDER_STATUSES.includes(order.status) &&
            order.orderType === "DineIn" && String(order.tableId ?? order.table) === String(tableId));
        if (table.active !== false && hasActiveOrder) throw new Error("A table with an active dine-in order cannot be deactivated.");
        setTables(previous => previous.map(item => String(item.id) === String(tableId)
            ? { ...item, active: item.active === false, updatedAt: now() }
            : item
        ));
    }

    // eslint-disable-next-line no-unused-vars
    function saveMenuItem(menuItemId, input) {
        requirePermission("menu:manage");
        const name = String(input?.name || "").trim();
        const price = Number(input?.price);
        if (!name || !Number.isFinite(price) || price <= 0) throw new Error("Enter an item name and a price greater than zero.");
        const normalized = {
            name,
            description: String(input.description || "").trim(),
            category: String(input.category || "").trim(),
            price: roundMoney(price)
        };
        if (menuItemId == null) {
            const item = { id: createId("menu"), ...normalized, available: true };
            setMenuItems(previous => [...previous, item]);
            return item;
        }
        const existing = menuItems.find(item => String(item.id) === String(menuItemId));
        if (!existing) throw new Error("Menu item not found.");
        const item = { ...existing, ...normalized, updatedAt: now() };
        setMenuItems(previous => previous.map(current => String(current.id) === String(menuItemId) ? item : current));
        return item;
    }

    // eslint-disable-next-line no-unused-vars
    function toggleMenuItemAvailability(menuItemId) {
        requirePermission("menu:manage");
        const existing = menuItems.find(item => String(item.id) === String(menuItemId));
        if (!existing) throw new Error("Menu item not found.");
        const next = existing.available === false;
        setMenuItems(previous => previous.map(item => String(item.id) === String(menuItemId)
            ? { ...item, available: next, updatedAt: now() }
            : item
        ));
        return next;
    }

    // eslint-disable-next-line no-unused-vars
    function updateWaiterAccountStatus(waiterId, active) {
        requirePermission("waiters:manage");
        if (typeof active !== "boolean") throw new Error("Waiter account status must be active or inactive.");
        const waiter = waiters.find(item => item.id === waiterId);
        if (!waiter) throw new Error("Waiter account not found.");
        setWaiters(previous => previous.map(item => item.id === waiterId
            ? { ...item, active, updatedAt: now() }
            : item
        ));
        if (!active) {
            const timestamp = now();
            setOrders(previous => previous.map(order => ACTIVE_ORDER_STATUSES.includes(order.status) && order.assignedWaiter?.userId === waiterId
                ? { ...order, assignedWaiter: null, assignmentStatus: "Unassigned", updatedAt: timestamp }
                : order
            ));
            setNotifications(previous => previous.map(notification => notification.recipientUserId === waiterId && notification.readAt == null
                ? {
                    ...notification,
                    recipientUserId: null,
                    recipientName: null,
                    title: `Unassigned KOT #${notification.kotSequence ?? 1} ready`,
                    type: "unassigned_kot_ready",
                    readAt: null,
                    updatedAt: timestamp
                }
                : notification
            ));
        }
    }

    // eslint-disable-next-line no-unused-vars
    function assignOrderWaiter(orderId, waiterId) {
        requirePermission("waiters:manage");
        const order = orders.find(item => item.id === orderId);
        if (!order) throw new Error("Order not found.");
        if (!ACTIVE_ORDER_STATUSES.includes(order.status)) throw new Error("Waiters can only be assigned to active orders.");
        const waiter = waiterId == null || waiterId === "" ? null : waiters.find(item => item.id === waiterId && item.active !== false);
        if (waiterId != null && waiterId !== "" && !waiter) throw new Error("Choose an active Waiter account.");
        const assignedWaiter = waiter ? { userId: waiter.id, name: waiter.name, username: waiter.username } : null;
        const timestamp = now();
        setOrders(previous => previous.map(item => item.id === orderId
            ? { ...item, assignedWaiter, assignmentStatus: assignedWaiter ? "Assigned" : "Unassigned", updatedAt: timestamp }
            : item
        ));
        const readyKots = kots.filter(kot => kot.orderId === orderId && kot.status === "Ready");
        setNotifications(previous => {
            const next = [...previous];
            readyKots.forEach(kot => {
                const index = next.findIndex(notification => notification.kotId === kot.id);
                if (index === -1) {
                    next.push(createReadyKotNotification(kot, order, assignedWaiter, kot.readyAt || kot.updatedAt || timestamp));
                    return;
                }
                const notification = next[index];
                const recipientUserId = assignedWaiter?.userId ?? null;
                const title = assignedWaiter
                    ? `KOT #${notification.kotSequence ?? kot.sequence ?? kot.kotNumber ?? 1} ready`
                    : `Unassigned KOT #${notification.kotSequence ?? kot.sequence ?? kot.kotNumber ?? 1} ready`;
                if (notification.recipientUserId === recipientUserId && notification.title === title) return;
                next[index] = {
                    ...notification,
                    recipientUserId,
                    recipientName: assignedWaiter?.name ?? null,
                    title,
                    type: assignedWaiter ? "kot_ready" : "unassigned_kot_ready",
                    ...(notification.recipientUserId !== recipientUserId ? { readAt: null } : {}),
                    updatedAt: timestamp
                };
            });
            return next;
        });
    }

    // eslint-disable-next-line no-unused-vars
    function markNotificationRead(notificationId) {
        if (storageError) throw new Error(storageError);
        const user = getStoredUser();
        const notification = notifications.find(item => item.id === notificationId);
        if (!notification) throw new Error("Notification not found.");
        if (hasPermission(user?.role, "notifications:own")) {
            if (notification.recipientUserId !== user.id) throw new Error("You can only acknowledge your own notifications.");
        } else if (!hasPermission(user?.role, "notifications:manage") || notification.recipientUserId != null) {
            throw new Error("You do not have permission to acknowledge this notification.");
        }
        const timestamp = now();
        setNotifications(previous => previous.map(item => item.id === notificationId
            ? { ...item, readAt: item.readAt || timestamp }
            : item
        ));
    }

    function requirePermission(permission) {
        if (storageError) throw new Error(storageError);
        const user = getStoredUser();
        if (!user || !hasPermission(user.role, permission)) {
            throw new Error("You do not have permission to perform this action.");
        }
    }

    function appendAuditEvent({ orderId, action, reason, previousStatus, newStatus, kotId = null, details = {} }) {
        const actor = getActorSnapshot();
        const event = {
            id: createId("audit"),
            orderId,
            ...(kotId ? { kotId } : {}),
            actorId: actor?.userId ?? null,
            actorName: actor?.name ?? "System",
            actorRole: actor?.role ?? "System",
            action,
            reason: String(reason || "").trim(),
            ...(previousStatus ? { previousStatus } : {}),
            ...(newStatus ? { newStatus } : {}),
            details,
            timestamp: now()
        };
        setAuditEvents(previous => [...previous, event]);
        return event;
    }

    function resolveKotNotifications(kotIds, resolutionReason, actor = getActorSnapshot(), timestamp = now()) {
        const ids = new Set(kotIds);
        setNotifications(previous => previous.map(notification => ids.has(notification.kotId) && !notification.resolvedAt
            ? {
                ...notification,
                resolvedAt: timestamp,
                resolvedBy: actor ? { userId: actor.userId, name: actor.name, role: actor.role } : null,
                resolutionReason,
                updatedAt: timestamp
            }
            : notification
        ));
    }

    function releaseTableIfNoActiveOrders(order, timestamp) {
        if (order.orderType !== "DineIn") return;
        const tableId = order.tableId ?? order.table;
        if (tableId == null) return;
        const anotherActiveOrderAtTable = orders.some(item =>
            item.id !== order.id &&
            item.orderType === "DineIn" &&
            String(item.tableId ?? item.table) === String(tableId) &&
            ACTIVE_ORDER_STATUSES.includes(item.status)
        );
        if (!anotherActiveOrderAtTable) {
            setTables(previous => previous.map(table =>
                String(table.id) === String(tableId)
                    ? { ...table, status: "Available", updatedAt: timestamp }
                    : table
            ));
        }
    }

    // eslint-disable-next-line no-unused-vars
    function updateRestaurantSettings(nextSettings) {
        if (storageError) return { ok: false, error: storageError };
        const user = getStoredUser();
        const isOwner = hasPermission(user?.role, "settings:full");
        const isManager = hasPermission(user?.role, "settings:limited");
        if (!isOwner && !isManager) {
            throw new Error("You do not have permission to update restaurant settings.");
        }
        if (!nextSettings || typeof nextSettings !== "object" || Array.isArray(nextSettings)) {
            throw new Error("Valid restaurant settings are required.");
        }
        const changes = isOwner ? nextSettings : Object.fromEntries(
            Object.entries(nextSettings).filter(([key]) => ["name", "phone", "address", "receiptFooter"].includes(key))
        );
        setRestaurantSettings(previous => ({ ...previous, ...changes }));
        return { ok: true };
    }

    function createKot(orderId, sequence, items) {
        const createdAt = now();

        return {
            id: createId("kot"),
            orderId,
            sequence,
            kotNumber: sequence,
            items: normalizeItems(items, menuItems),
            status: "Queued",
            createdAt,
            updatedAt: createdAt
        };
    }

    // eslint-disable-next-line no-unused-vars
    function createOrder(input) {
        requirePermission("orders:create");
        if (!input || !Array.isArray(input.items) || input.items.length === 0) {
            throw new Error("An order must contain at least one item.");
        }

        const createdAt = now();
        const orderId = createId("order");
        const items = normalizeItems(input.items, menuItems);
        const tableId = input.tableId ?? input.table ?? null;

        const requestedType = String(input.orderType ?? (tableId ? "DineIn" : "Takeaway"))
            .toLowerCase()
            .replace(/[\s_-]/g, "");

        const orderType = requestedType === "dinein"
            ? "DineIn"
            : requestedType === "takeaway" || requestedType === "takeout"
                ? "Takeaway"
                : null;

        if (!orderType) {
            throw new Error("Order type must be dine-in or takeaway.");
        }

        if (orderType === "DineIn" && tableId === null) {
            throw new Error("A table is required for a dine-in order.");
        }

        if (orderType === "DineIn") {
            const selectedTable = tables.find(table =>
                String(table.id) === String(tableId)
            );

            if (!selectedTable) {
                throw new Error(`Table ${tableId} does not exist.`);
            }

            if (selectedTable.status !== "Available" || selectedTable.active === false) {
                throw new Error(`Table ${tableId} is not available.`);
            }
            if (orders.some(order => ACTIVE_ORDER_STATUSES.includes(order.status) && order.orderType === "DineIn" &&
                String(order.tableId ?? order.table) === String(tableId))) {
                throw new Error(`Table ${tableId} already has an active dine-in order.`);
            }
        }

        const firstKot = createKot(orderId, 1, items);
        const initialTotals = calculateBillTotals(items, 0, restaurantSettings.gstRate ?? GST_RATE);
        const billId = createId("bill");
        const user = getStoredUser();
        const activeWaiters = waiters.filter(waiter => waiter.active !== false);
        let assignedWaiter = null;
        if (user?.role === "Waiter") {
            const waiter = activeWaiters.find(item => item.id === user.id);
            if (!waiter) throw new Error("Your Waiter account is inactive or unavailable. Ask a Manager or Owner for access.");
            assignedWaiter = { userId: waiter.id, name: waiter.name, username: waiter.username };
        } else if (activeWaiters.length > 0) {
            const selectedIndex = roundRobinPointer % activeWaiters.length;
            const waiter = activeWaiters[selectedIndex];
            assignedWaiter = { userId: waiter.id, name: waiter.name, username: waiter.username };
            setRoundRobinPointer((selectedIndex + 1) % activeWaiters.length);
        }

        const order = {
            id: orderId,
            orderNumber: input.orderNumber ?? orderId,
            orderType,
            tableId,

            // Legacy aliases retained for the existing pages.
            table: tableId,

            customerName: input.customerName ?? "",
            customerPhone: input.customerPhone ?? "",
            createdBy: user ? { userId: user.id, name: user.name || user.username, role: user.role } : null,
            assignedWaiter,
            assignmentStatus: assignedWaiter ? "Assigned" : "Unassigned",
            status: "Open",
            kotIds: [firstKot.id],
            billId,
            items,
            total: initialTotals.subtotal,
            paymentStatus: getPaymentStatus(0, initialTotals.grandTotal),
            paymentMethod: "",
            createdAt,
            updatedAt: createdAt
        };

        const bill = {
            id: billId,
            orderId,
            status: initialTotals.grandTotal === 0 ? "Settled" : "Open",
            items,
            ...initialTotals,
            currency: restaurantSettings.currency || "INR",
            createdAt,
            updatedAt: createdAt,
            ...(initialTotals.grandTotal === 0 ? {
                settlementType: "ZeroBalance",
                settledAt: createdAt,
                settledBy: user ? { userId: user.id, name: user.name || user.username, role: user.role } : { role: "System", name: "System" }
            } : {})
        };

        setOrders(previous => [...previous, order]);
        setKots(previous => [...previous, firstKot]);
        setBills(previous => [...previous, bill]);

        if (orderType === "DineIn" && tableId !== null) {
            setTables(previous => previous.map(table =>
                String(table.id) === String(tableId)
                    ? { ...table, status: "Occupied" }
                    : table
            ));
        }

        if (initialTotals.grandTotal === 0) {
            appendAuditEvent({
                orderId,
                action: "bill_zero_balance_settled",
                reason: "The final payable balance was zero; no payment transaction was created.",
                details: { billId, grandTotal: 0, settlementType: "ZeroBalance" }
            });
        }

        return order;
    }

    // eslint-disable-next-line no-unused-vars
    function addItemsToOrder(orderId, newItems) {
        requirePermission("orders:addItems");
        const order = orders.find(item => item.id === orderId);

        if (!order || !ACTIVE_ORDER_STATUSES.includes(order.status)) {
            throw new Error("Items can only be added to an open order.");
        }
        const user = getStoredUser();
        if (user?.role === "Waiter" && order.assignedWaiter?.userId !== user.id) {
            throw new Error("Waiters can only add items to orders assigned to them.");
        }

        const existingBill = bills.find(item =>
            item.orderId === orderId && (!order.billId || item.id === order.billId)
        );

        if (!existingBill) {
            throw new Error("Cannot add items because the order's bill does not exist.");
        }

        if (existingBill.status !== "Open") {
            throw new Error("Items can only be added while the bill is open.");
        }

        const normalizedItems = normalizeItems(newItems, menuItems);
        const discount = Number(existingBill.discount ?? 0);

        const allItems = [
            ...getBillableItems(kots.filter(item => item.orderId === orderId)),
            ...normalizedItems
        ];

        const subtotalCents = allItems.reduce(
            (sum, item) => sum + moneyToCents(item.unitPrice * item.quantity),
            0
        );

        const discountCents = moneyToCents(discount);

        if (!Number.isFinite(discount) || !Number.isSafeInteger(discountCents) ||
            discountCents < 0 || discountCents > subtotalCents) {
            throw new Error("The existing discount is invalid for the updated bill subtotal.");
        }

        const totals = calculateBillTotals(allItems, discount, existingBill.taxRate ?? GST_RATE);
        const paidAmount = getCompletedPaymentTotal(payments, orderId, existingBill.id);
        const paidCents = moneyToCents(paidAmount);
        const grandTotalCents = moneyToCents(totals.grandTotal);

        if (paidCents > grandTotalCents) {
            throw new Error("The updated bill total cannot be less than completed payments.");
        }

        const isZeroBalance = grandTotalCents === 0 && paidCents === 0;
        const isSettled = isZeroBalance || (paidCents > 0 && paidCents === grandTotalCents);
        const timestamp = now();

        const sequence = kots
            .filter(kot => kot.orderId === orderId)
            .reduce((max, kot) => Math.max(max, kot.sequence || 0), 0) + 1;

        const kot = createKot(orderId, sequence, normalizedItems);
        const updatedKots = [...kots, kot];
        const paymentStatus = getPaymentStatus(paidAmount, totals.grandTotal);

        setKots(updatedKots);

        setOrders(previous => previous.map(item => item.id === orderId
            ? {
                ...item,
                kotIds: [...(item.kotIds || []), kot.id],
                items: allItems,
                total: totals.subtotal,
                paymentStatus,
                updatedAt: timestamp
            }
            : item
        ));

        if (existingBill) {
            setBills(previous => previous.map(bill => bill.id === existingBill.id
                ? {
                    ...bill,
                    items: allItems,
                    ...totals,
                    status: isSettled ? "Settled" : "Open",
                    ...(isSettled ? {
                        settledAt: timestamp,
                        ...(isZeroBalance ? { settlementType: "ZeroBalance", settledBy: getActorSnapshot() || { role: "System", name: "System" } } : {})
                    } : {}),
                    updatedAt: timestamp
                }
                : bill
            ));
        }

        if (isZeroBalance && existingBill) {
            appendAuditEvent({
                orderId,
                action: "bill_zero_balance_settled",
                reason: "The updated payable balance was zero; no payment transaction was created.",
                details: { billId: existingBill.id, grandTotal: 0, settlementType: "ZeroBalance" }
            });
        }

        return kot;
    }

    // eslint-disable-next-line no-unused-vars
    function updateKotStatus(kotId, status, cancellationReason = "") {
        requirePermission("kitchen:update");
        const allowedStatuses = ["Queued", "Preparing", "Ready", "Cancelled"];

        if (!allowedStatuses.includes(status)) {
            throw new Error("Kitchen Staff can move KOTs to Preparing or Ready. Serving and legacy Closed statuses use separate workflows.");
        }

        const changedKot = kots.find(kot => kot.id === kotId);

        if (!changedKot) {
            throw new Error("KOT not found.");
        }

        if (["Cancelled", "Served", "Closed"].includes(changedKot.status) && status !== changedKot.status) {
            throw new Error("A terminal KOT cannot be reopened or changed.");
        }

        const validTransition = (changedKot.status === "Queued" && ["Preparing", "Cancelled"].includes(status)) ||
            (changedKot.status === "Preparing" && ["Ready", "Cancelled"].includes(status)) ||
            (changedKot.status === "Ready" && status === "Cancelled");
        if (changedKot.status !== status && !validTransition) {
            throw new Error(`KOT cannot move from ${changedKot.status} to ${status}.`);
        }

        const order = orders.find(item => item.id === changedKot.orderId);

        if (!order) {
            throw new Error("Cannot update this KOT because its order does not exist.");
        }

        if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
            throw new Error("KOTs cannot be changed after their order is completed or cancelled.");
        }

        const bill = bills.find(item =>
            item.orderId === order.id && (!order.billId || item.id === order.billId)
        );

        if (!bill) {
            throw new Error("Cannot update this KOT because its bill does not exist.");
        }

        if (changedKot.status === status) {
            return;
        }

        const timestamp = now();
        if (status === "Cancelled") {
            requirePermission("kitchen:cancel");
            const reason = String(cancellationReason || "").trim();
            if (!reason) throw new Error("A cancellation reason is required.");
            if (bill.status !== "Open") throw new Error("Only an open bill's KOT can be cancelled.");
            const actor = getActorSnapshot();
            const updatedKots = kots.map(kot => kot.id === kotId
                ? { ...kot, status, cancellationReason: reason, cancelledBy: actor, cancelledAt: timestamp, updatedAt: timestamp }
                : kot
            );
            recalculateBillFromKots(order, bill, updatedKots, timestamp, `Cannot cancel KOT #${changedKot.sequence}`);
            resolveKotNotifications([kotId], reason, actor, timestamp);
            appendAuditEvent({ orderId: order.id, kotId, action: "kot_cancelled", reason, previousStatus: changedKot.status, newStatus: "Cancelled" });
            return;
        }

        setKots(previous => previous.map(kot => kot.id === kotId
            ? { ...kot, status, ...(status === "Ready" ? { readyAt: timestamp } : {}), updatedAt: timestamp }
            : kot
        ));
        if (status === "Ready") {
            const notification = createReadyKotNotification(changedKot, order, order.assignedWaiter, timestamp);
            setNotifications(previous => previous.some(item => item.kotId === changedKot.id)
                ? previous.map(item => item.kotId === changedKot.id && !item.resolvedAt
                    ? { ...item, items: notification.items, updatedAt: timestamp }
                    : item)
                : [...previous, notification]
            );
        }
        if (status === "Preparing" && order.status === "Open") {
            setOrders(previous => previous.map(item => item.id === order.id
                ? { ...item, status: "In Progress", updatedAt: timestamp }
                : item
            ));
        }
        appendAuditEvent({ orderId: order.id, kotId, action: "kot_status_changed", reason: `KOT moved to ${status}`, previousStatus: changedKot.status, newStatus: status });
    }

    function recalculateBillFromKots(order, bill, updatedKots, timestamp, errorPrefix = "Cannot update KOT") {
        if (bill.status !== "Open") throw new Error("KOT items can only be changed while the bill is Open.");
        const orderKots = updatedKots.filter(kot => kot.orderId === order.id);
        const billableItems = getBillableItems(orderKots);
        const discount = Number(bill.discount ?? 0);
        const subtotalCents = billableItems.reduce((sum, item) => sum + moneyToCents(item.unitPrice * item.quantity), 0);
        const discountCents = moneyToCents(discount);
        if (!Number.isFinite(discount) || !Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents > subtotalCents) {
            throw new Error(`${errorPrefix}: bill discount would be invalid.`);
        }
        const totals = calculateBillTotals(billableItems, discount, bill.taxRate ?? GST_RATE);
        const paidAmount = getCompletedPaymentTotal(payments, order.id, bill.id);
        const paidCents = moneyToCents(paidAmount);
        const grandTotalCents = moneyToCents(totals.grandTotal);
        if (grandTotalCents < paidCents) {
            throw new Error(`${errorPrefix}: remaining bill total would be less than completed payments.`);
        }
        const isZeroBalance = grandTotalCents === 0 && paidCents === 0;
        const isSettled = isZeroBalance || (paidCents > 0 && paidCents === grandTotalCents);
        setKots(updatedKots);
        setOrders(previous => previous.map(item => item.id === order.id
            ? { ...item, items: billableItems, total: totals.subtotal, paymentStatus: getPaymentStatus(paidAmount, totals.grandTotal), updatedAt: timestamp }
            : item
        ));
        setBills(previous => previous.map(item => item.id === bill.id
            ? {
                ...item,
                items: billableItems,
                ...totals,
                status: isSettled ? "Settled" : "Open",
                ...(isSettled ? {
                    settledAt: timestamp,
                    ...(isZeroBalance ? { settlementType: "ZeroBalance", settledBy: getActorSnapshot() || { role: "System", name: "System" } } : {})
                } : {}),
                updatedAt: timestamp
            }
            : item
        ));
        if (isZeroBalance) {
            appendAuditEvent({
                orderId: order.id,
                action: "bill_zero_balance_settled",
                reason: "The recalculated payable balance was zero; no payment transaction was created.",
                details: { billId: bill.id, grandTotal: 0, settlementType: "ZeroBalance" }
            });
        }
    }

    // eslint-disable-next-line no-unused-vars
    function serveKot(kotId) {
        requirePermission("kitchen:serve");
        const user = getStoredUser();
        const kot = kots.find(item => item.id === kotId);
        if (!kot) throw new Error("KOT not found.");
        const order = orders.find(item => item.id === kot.orderId);
        if (!order || !ACTIVE_ORDER_STATUSES.includes(order.status)) throw new Error("Only KOTs on active orders can be served.");
        if (kot.status !== "Ready") throw new Error("Only a Ready KOT can be marked as Served.");
        if (user.role === "Waiter" && order.assignedWaiter?.userId !== user.id) {
            throw new Error("Only the Waiter assigned to this order can mark this KOT as Served.");
        }
        const timestamp = now();
        const actor = getActorSnapshot(user);
        setKots(previous => previous.map(item => item.id === kotId
            ? { ...item, status: "Served", servedAt: timestamp, servedBy: actor, updatedAt: timestamp }
            : item
        ));
        resolveKotNotifications([kotId], "KOT served", actor, timestamp);
        appendAuditEvent({ orderId: order.id, kotId, action: "kot_served", reason: "Food service confirmed", previousStatus: "Ready", newStatus: "Served" });
        return { ...kot, status: "Served", servedAt: timestamp, servedBy: actor, updatedAt: timestamp };
    }

    // eslint-disable-next-line no-unused-vars
    function cancelKotItem(kotId, lineId, quantity, reasonInput) {
        requirePermission("kitchen:cancel");
        const kot = kots.find(item => item.id === kotId);
        if (!kot) throw new Error("KOT not found.");
        const order = orders.find(item => item.id === kot.orderId);
        if (!order || !ACTIVE_ORDER_STATUSES.includes(order.status)) throw new Error("Items can only be cancelled on an active order.");
        if (["Served", "Cancelled", "Closed"].includes(kot.status)) throw new Error("Items on a Served or closed KOT cannot be cancelled through this action.");
        const bill = bills.find(item => item.id === order.billId) || bills.find(item => item.orderId === order.id);
        if (!bill || bill.status !== "Open") throw new Error("An open bill is required to cancel KOT items.");
        const reason = String(reasonInput || "").trim();
        if (!reason) throw new Error("A cancellation reason is required.");
        const line = kot.items.find(item => item.lineId === lineId);
        if (!line) throw new Error("KOT item was not found.");
        const remainingQuantity = Number(line.quantity) - Number(line.cancelledQuantity || 0);
        const cancelQuantity = Number(quantity);
        if (!Number.isSafeInteger(cancelQuantity) || cancelQuantity <= 0 || cancelQuantity > remainingQuantity) {
            throw new Error(`Cancellation quantity must be between 1 and ${remainingQuantity}.`);
        }
        const timestamp = now();
        const actor = getActorSnapshot();
        const updatedKots = kots.map(item => {
            if (item.id !== kotId) return item;
            const nextItems = item.items.map(kotItem => kotItem.lineId !== lineId ? kotItem : {
                ...kotItem,
                cancelledQuantity: Number(kotItem.cancelledQuantity || 0) + cancelQuantity,
                cancellations: [...(kotItem.cancellations || []), { id: createId("item_cancel"), quantity: cancelQuantity, reason, actor, timestamp }]
            });
            const allItemsCancelled = nextItems.every(kotItem => Number(kotItem.quantity) <= Number(kotItem.cancelledQuantity || 0));
            return {
                ...item,
                items: nextItems,
                ...(allItemsCancelled ? { status: "Cancelled", cancellationReason: "All KOT item quantities cancelled", cancelledBy: actor, cancelledAt: timestamp } : {}),
                updatedAt: timestamp
            };
        });
        recalculateBillFromKots(order, bill, updatedKots, timestamp, "Cannot cancel KOT item");
        if (updatedKots.find(item => item.id === kotId)?.status === "Cancelled") {
            resolveKotNotifications([kotId], reason, actor, timestamp);
        } else if (kot.status === "Ready") {
            const updatedKot = updatedKots.find(item => item.id === kotId);
            const activeItems = updatedKot.items.map(item => ({
                name: item.name,
                quantity: Number(item.quantity) - Number(item.cancelledQuantity || 0),
                notes: item.notes || ""
            })).filter(item => item.quantity > 0);
            setNotifications(previous => previous.map(item => item.kotId === kotId && !item.resolvedAt
                ? { ...item, items: activeItems, updatedAt: timestamp }
                : item
            ));
        }
        appendAuditEvent({ orderId: order.id, kotId, action: "kot_item_cancelled", reason, previousStatus: kot.status, newStatus: updatedKots.find(item => item.id === kotId)?.status, details: { lineId, quantity: cancelQuantity } });
        return updatedKots.find(item => item.id === kotId);
    }

    // eslint-disable-next-line no-unused-vars
    function updateOrderStatus(orderId, status, options = {}) {
        requirePermission("orders:manage");
        if (!(["Completed", "Cancelled"].includes(status))) throw new Error("Orders can only be completed or cancelled through this action.");
        const order = orders.find(item => item.id === orderId);
        if (!order) throw new Error("Order not found.");
        if (order.status === status) return;
        if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
            throw new Error(`A ${order.status} order is closed and cannot transition to ${status}.`);
        }

        const bill = bills.find(item => item.orderId === orderId && (!order.billId || item.id === order.billId));
        const paidAmount = getCompletedPaymentTotal(payments, orderId, bill?.id);
        const paidCents = moneyToCents(paidAmount);
        const timestamp = now();
        const actor = getActorSnapshot();
        const orderKots = kots.filter(kot => kot.orderId === orderId);

        if (status === "Completed") {
            if (!bill || !["Open", "Settled"].includes(bill.status)) {
                throw new Error("Cannot complete this order because it has no payable bill.");
            }
            const unservedKots = orderKots.filter(kot => !["Served", "Cancelled"].includes(kot.status));
            const outstandingCents = Math.max(0, moneyToCents(bill.grandTotal) - paidCents);
            const billIsPaid = bill.status === "Settled" && paidCents >= moneyToCents(bill.grandTotal);
            const blockers = [];
            if (unservedKots.length) blockers.push(`${unservedKots.length} KOT(s) are not Served`);
            if (!billIsPaid) blockers.push(`outstanding balance is ₹${centsToMoney(outstandingCents).toFixed(2)}`);
            const overrideReason = String(options?.overrideReason || "").trim();
            const isOverride = Boolean(options?.override);

            if (blockers.length && !isOverride) {
                throw new Error(`Order cannot be completed normally: ${blockers.join(" and ")}. Use the Manager/Owner override with a reason if this is an exception.`);
            }
            if (isOverride && !overrideReason) throw new Error("A reason is required for an order completion override.");
            if (!isOverride && blockers.length) throw new Error(`Order cannot be completed: ${blockers.join(" and ")}.`);
            if (paidCents > moneyToCents(bill.grandTotal)) throw new Error("Completed payments exceed the bill total. Review the bill before completing this order.");

            const completionType = isOverride ? "Override" : "Normal";
            const completionReason = isOverride ? overrideReason : "All non-cancelled KOTs served and bill paid.";
            const completion = {
                completionType,
                completionReason,
                completedBy: actor,
                completedAt: timestamp,
                ...(isOverride ? {
                    outstandingKotIds: unservedKots.map(kot => kot.id),
                    unpaidAmount: centsToMoney(outstandingCents)
                } : {})
            };
            setOrders(previous => previous.map(item => item.id === orderId
                ? { ...item, status: "Completed", ...completion, updatedAt: timestamp }
                : item
            ));
            if (isOverride) {
                resolveKotNotifications(orderKots.map(kot => kot.id), "Order completed by Manager/Owner override", actor, timestamp);
            }
            appendAuditEvent({
                orderId,
                action: isOverride ? "order_completion_override" : "order_completed",
                reason: completionReason,
                previousStatus: order.status,
                newStatus: "Completed",
                details: { outstandingKotIds: unservedKots.map(kot => kot.id), unpaidAmount: centsToMoney(outstandingCents) }
            });
            releaseTableIfNoActiveOrders(order, timestamp);
            return { ...order, status: "Completed", ...completion, updatedAt: timestamp };
        }

        const reason = String(options?.reason || "").trim();
        if (!reason) throw new Error("A cancellation reason is required.");
        if (!bill) throw new Error("Cannot safely cancel this order because its bill is missing. Review the legacy order first.");
        if (paidCents > 0) {
            throw new Error(`Cannot cancel this order because ₹${paidAmount.toFixed(2)} has been received and refunds are not supported. Preserve payment history and process a refund before retrying.`);
        }
        if (bill?.status === "Settled" && bill.settlementType !== "ZeroBalance") {
            throw new Error("Cannot cancel an order with a settled bill and no matching completed payment records. Review the legacy bill first.");
        }
        if (orderKots.some(kot => kot.status === "Served")) {
            throw new Error("Cannot cancel the full order after food has been marked Served. Cancel unserved items individually and settle the remaining bill.");
        }

        const cancelledBy = actor;
        const updatedKots = kots.map(kot => kot.orderId === orderId && ["Queued", "Preparing", "Ready"].includes(kot.status)
            ? { ...kot, status: "Cancelled", cancellationReason: reason, cancelledBy, cancelledAt: timestamp, updatedAt: timestamp }
            : kot
        );
        setKots(updatedKots);
        setOrders(previous => previous.map(item => item.id === orderId
            ? { ...item, status: "Cancelled", cancellationReason: reason, cancelledBy, cancelledAt: timestamp, paymentStatus: getPaymentStatus(paidAmount, bill?.grandTotal ?? 0), updatedAt: timestamp }
            : item
        ));
        if (bill?.status === "Open") {
            setBills(previous => previous.map(item => item.id === bill.id
                ? { ...item, status: "Void", voidedAt: timestamp, voidReason: reason, updatedAt: timestamp }
                : item
            ));
        }
        resolveKotNotifications(orderKots.map(kot => kot.id), "Order cancelled", actor, timestamp);
        appendAuditEvent({ orderId, action: "order_cancelled", reason, previousStatus: order.status, newStatus: "Cancelled", details: { resolvedKotIds: orderKots.filter(kot => ["Queued", "Preparing", "Ready"].includes(kot.status)).map(kot => kot.id) } });
        releaseTableIfNoActiveOrders(order, timestamp);
        return { ...order, status: "Cancelled", cancellationReason: reason, cancelledBy, cancelledAt: timestamp };
    }

    // eslint-disable-next-line no-unused-vars
    function setBillDiscount(orderId, discountAmount) {
        requirePermission("billing:manage");
        const bill = bills.find(item => item.orderId === orderId);

        if (!bill || bill.status !== "Open") {
            throw new Error("An open bill is required to apply a discount.");
        }

        const rawDiscount = Number(discountAmount);

        if ((typeof discountAmount !== "number" && typeof discountAmount !== "string") ||
            (typeof discountAmount === "string" && discountAmount.trim() === "") ||
            !Number.isFinite(rawDiscount) || rawDiscount < 0) {
            throw new Error("Discount must be between zero and the bill subtotal.");
        }

        const discountCents = moneyToCents(rawDiscount);

        if (!Number.isSafeInteger(discountCents) || discountCents > moneyToCents(bill.subtotal)) {
            throw new Error("Discount must be between zero and the bill subtotal.");
        }

        const discount = centsToMoney(discountCents);
        const totals = calculateBillTotals(bill.items, discount, bill.taxRate ?? GST_RATE);
        const completedPayments = getCompletedPaymentTotal(payments, orderId, bill.id);
        const completedPaymentCents = moneyToCents(completedPayments);
        const grandTotalCents = moneyToCents(totals.grandTotal);

        if (completedPaymentCents > grandTotalCents) {
            throw new Error("Discount cannot reduce the bill below payments already received.");
        }

        const isZeroBalance = grandTotalCents === 0 && completedPaymentCents === 0;
        const isSettled = isZeroBalance || (completedPaymentCents > 0 && completedPaymentCents === grandTotalCents);

        const timestamp = now();

        setBills(previous => previous.map(item => item.id === bill.id
            ? {
                ...item,
                ...totals,
                status: isSettled ? "Settled" : "Open",
                ...(isSettled ? {
                    settledAt: timestamp,
                    ...(isZeroBalance ? { settlementType: "ZeroBalance", settledBy: getActorSnapshot() || { role: "System", name: "System" } } : {})
                } : {}),
                updatedAt: timestamp
            }
            : item
        ));

        const paymentStatus = getPaymentStatus(completedPayments, totals.grandTotal);

        setOrders(previous => previous.map(order => order.id === orderId
            ? { ...order, paymentStatus, updatedAt: timestamp }
            : order
        ));

        if (isZeroBalance) {
            appendAuditEvent({
                orderId,
                action: "bill_zero_balance_settled",
                reason: "The final payable balance was zero; no payment transaction was created.",
                details: { billId: bill.id, grandTotal: 0, settlementType: "ZeroBalance" }
            });
        }

        return {
            ...bill,
            ...totals,
            status: isSettled ? "Settled" : "Open",
            ...(isSettled ? {
                settledAt: timestamp,
                ...(isZeroBalance ? { settlementType: "ZeroBalance", settledBy: getActorSnapshot() || { role: "System", name: "System" } } : {})
            } : {}),
            updatedAt: timestamp
        };
    }

    // eslint-disable-next-line no-unused-vars
    function recordPayment(orderId, paymentInput) {
        requirePermission("billing:manage");
        const order = orders.find(item => item.id === orderId);
        if (!order || order.status === "Cancelled") {
            throw new Error("Payment cannot be recorded for a missing or cancelled order.");
        }
        const bill = bills.find(item => item.orderId === orderId);

        if (!bill || bill.status !== "Open") {
            throw new Error("An open bill is required to record payment.");
        }

        if (!paymentInput || typeof paymentInput !== "object") {
            throw new Error("Payment details are required.");
        }

        const rawAmount = Number(paymentInput.amountApplied ?? paymentInput.amount);

        const amountInput = paymentInput.amountApplied ?? paymentInput.amount;
        if ((typeof amountInput !== "number" && typeof amountInput !== "string") ||
            (typeof amountInput === "string" && amountInput.trim() === "") ||
            !Number.isFinite(rawAmount) || rawAmount <= 0) {
            throw new Error("The amount applied to the bill must be greater than zero.");
        }

        const amountAppliedMinor = moneyToCents(rawAmount);

        if (!Number.isSafeInteger(amountAppliedMinor) || amountAppliedMinor <= 0) {
            throw new Error("The amount applied must be at least 0.01.");
        }

        const amountApplied = centsToMoney(amountAppliedMinor);
        const rawTip = paymentInput.tipAmount ?? 0;
        const tipValue = Number(rawTip);
        if ((typeof rawTip !== "number" && typeof rawTip !== "string") ||
            (typeof rawTip === "string" && rawTip.trim() === "") ||
            !Number.isFinite(tipValue) || tipValue < 0) {
            throw new Error("Tip must be zero or a positive amount.");
        }
        const tipMinor = moneyToCents(tipValue);
        if (!Number.isSafeInteger(tipMinor) || tipMinor < 0) {
            throw new Error("Tip exceeds the supported monetary range.");
        }
        const allowedMethods = ["Cash", "UPI", "Card"];

        if (!allowedMethods.includes(paymentInput.method)) {
            throw new Error("Payment method must be Cash, UPI or Card.");
        }

        const paymentStatus = paymentInput.status ?? "Completed";

        if (paymentStatus === "Refunded") {
            throw new Error("Refunded payments are not supported by this action.");
        }

        if (!["Pending", "Completed", "Failed"].includes(paymentStatus)) {
            throw new Error("Invalid payment status.");
        }

        const completedPayments = getCompletedPaymentTotal(payments, orderId, bill.id);
        const completedPaymentCents = moneyToCents(completedPayments);
        const grandTotalCents = moneyToCents(bill.grandTotal);

        if (paymentStatus === "Completed" &&
            completedPaymentCents + amountAppliedMinor > grandTotalCents) {
            throw new Error("The amount applied to the bill exceeds its outstanding balance.");
        }

        const totalDueMinor = amountAppliedMinor + tipMinor;
        if (!Number.isSafeInteger(totalDueMinor)) {
            throw new Error("Payment total exceeds the supported monetary range.");
        }

        let cashTenderedMinor = null;
        let changeReturnedMinor = 0;
        if (paymentInput.method === "Cash") {
            const cashInput = paymentInput.cashTendered;
            if (cashInput == null || cashInput === "") {
                cashTenderedMinor = totalDueMinor;
            } else {
                const cashValue = Number(cashInput);
                if ((typeof cashInput !== "number" && typeof cashInput !== "string") ||
                    (typeof cashInput === "string" && cashInput.trim() === "") ||
                    !Number.isFinite(cashValue) || cashValue < 0) {
                    throw new Error("Cash tendered must be zero or a positive amount.");
                }
                cashTenderedMinor = moneyToCents(cashValue);
            }
            if (!Number.isSafeInteger(cashTenderedMinor) || cashTenderedMinor < totalDueMinor) {
                throw new Error("Cash tendered must cover the bill amount and tip.");
            }
            changeReturnedMinor = cashTenderedMinor - totalDueMinor;
        }

        const timestamp = now();

        const totalAmountMinor = paymentInput.method === "Cash" ? cashTenderedMinor : totalDueMinor;

        const payment = {
            id: createId("payment"),
            orderId,
            billId: bill.id,
            amount: amountApplied,
            amountApplied,
            amountAppliedMinor,
            tipAmount: centsToMoney(tipMinor),
            tipMinor,
            totalDueFromCustomer: centsToMoney(totalDueMinor),
            totalDueFromCustomerMinor: totalDueMinor,
            totalAmountReceivedOrCharged: centsToMoney(totalAmountMinor),
            totalAmountMinor,
            amountCharged: paymentInput.method === "Cash" ? null : centsToMoney(totalDueMinor),
            amountChargedMinor: paymentInput.method === "Cash" ? null : totalDueMinor,
            cashTendered: paymentInput.method === "Cash" ? centsToMoney(cashTenderedMinor) : null,
            cashTenderedMinor,
            changeReturned: centsToMoney(changeReturnedMinor),
            changeReturnedMinor,
            method: paymentInput.method,
            status: paymentStatus,
            mode: paymentInput.mode === "Partial" ? "Partial" : "Full",
            timestamp,
            createdAt: timestamp
        };

        const nextPaidCents = completedPaymentCents +
            (payment.status === "Completed" ? amountAppliedMinor : 0);

        const nextPaidAmount = centsToMoney(nextPaidCents);
        const updatedPaymentStatus = getPaymentStatus(nextPaidAmount, bill.grandTotal);

        const isSettled = payment.status === "Completed" &&
            nextPaidCents > 0 && nextPaidCents === grandTotalCents;

        setPayments(previous => [...previous, payment]);

        if (isSettled) {
            setBills(previous => previous.map(item => item.id === bill.id
                ? { ...item, status: "Settled", settledAt: timestamp, updatedAt: timestamp }
                : item
            ));
        }

        setOrders(previous => previous.map(item => item.id === orderId
            ? {
                ...item,
                paymentStatus: updatedPaymentStatus,
                ...(payment.status === "Completed" ? {
                    paymentMethod: paymentInput.method
                } : {}),
                updatedAt: timestamp
            }
            : item
        ));

        return payment;
    }

    // eslint-disable-next-line no-unused-vars
    function settleZeroBalanceBill(billId) {
        requirePermission("billing:manage");
        const bill = bills.find(item => item.id === billId);
        if (!bill) throw new Error("Bill not found.");
        if (bill.status !== "Open") throw new Error("Only an open bill can be settled as a zero balance.");
        const order = orders.find(item => item.id === bill.orderId);
        if (!order || order.status === "Cancelled") throw new Error("A missing or cancelled order cannot receive a zero-balance settlement.");

        const billableItems = kots.some(kot => kot.orderId === order.id)
            ? getBillableItems(kots.filter(kot => kot.orderId === order.id))
            : bill.items || [];
        const discountCents = moneyToCents(bill.discount ?? 0);
        const subtotalCents = billableItems.reduce((sum, item) => sum + moneyToCents(item.unitPrice * item.quantity), 0);
        if (!Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents > subtotalCents) {
            throw new Error("The bill discount is invalid; review the bill before settling it.");
        }
        const totals = calculateBillTotals(billableItems, centsToMoney(discountCents), bill.taxRate ?? GST_RATE);
        if (moneyToCents(bill.grandTotal) !== 0 || moneyToCents(totals.grandTotal) !== 0) {
            throw new Error("This bill has a payable balance. A zero-balance settlement is only allowed when the final total is exactly zero.");
        }
        const completedPayments = getCompletedPaymentTotal(payments, bill.orderId, bill.id);
        if (moneyToCents(completedPayments) !== 0) {
            throw new Error("This bill has completed payment history and cannot be settled as a zero balance.");
        }

        const timestamp = now();
        const actor = getActorSnapshot() || { role: "System", name: "System" };
        const settledBill = {
            ...bill,
            ...totals,
            status: "Settled",
            settlementType: "ZeroBalance",
            settledAt: timestamp,
            settledBy: actor,
            updatedAt: timestamp
        };
        setBills(previous => previous.map(item => item.id === bill.id ? settledBill : item));
        setOrders(previous => previous.map(item => item.id === order.id
            ? { ...item, paymentStatus: "Paid", updatedAt: timestamp }
            : item
        ));
        appendAuditEvent({
            orderId: order.id,
            action: "bill_zero_balance_settled",
            reason: "The final payable balance was zero; no payment transaction was created.",
            details: { billId: bill.id, grandTotal: 0, settlementType: "ZeroBalance" }
        });
        return settledBill;
    }

    // eslint-disable-next-line no-unused-vars
    function updateBillStatus(billId, status) {
        requirePermission("billing:manage");
        if (!["Open", "Settled", "Void"].includes(status)) {
            throw new Error("Invalid bill status.");
        }

        const bill = bills.find(item => item.id === billId);

        if (!bill) {
            throw new Error("Bill not found.");
        }

        if (bill.status === "Void" && status !== "Void") {
            throw new Error("A void bill cannot be reopened or settled.");
        }

        if (bill.status === "Settled" && status !== "Settled") {
            throw new Error("A settled bill cannot be reopened or voided.");
        }

        if (status === bill.status) {
            return;
        }

        if (status === "Settled") {
            throw new Error("Bills can only be settled by recording payment.");
        }

        const completedPayments = getCompletedPaymentTotal(
            payments,
            bill.orderId,
            bill.id
        );

        if (status === "Void" && completedPayments > 0) {
            throw new Error("A bill with completed payments cannot be voided.");
        }

        // A bill can only be voided when its associated order is Cancelled.
        // Completed orders with unpaid or partially paid bills must remain Open.
        if (status === "Void") {
            const order = orders.find(item => item.id === bill.orderId);

            if (!order || order.status !== "Cancelled") {
                throw new Error(
                    "A bill can only be voided after its associated order has been cancelled."
                );
            }
        }

        setBills(previous => previous.map(bill => bill.id === billId
            ? { ...bill, status, updatedAt: now() }
            : bill
        ));
    }

    return (
        <RestaurantContext.Provider
            value={{
                tables,
                orders,
                kots,
                bills,
                payments,
                auditEvents,
                waiters,
                kitchenStaff,
                managerAccounts,
                notifications,
                storageError,
                remoteStateReady,
                remoteStateError,
                retryRemoteState: () => setRemoteRetryCount(value => value + 1),
                menuItems,
                restaurantSettings,
                saveMenuItem: async (menuItemId, input) => {
                    const result = menuItemId == null
                        ? await apiRequest('/menu', { method: 'POST', body: input })
                        : await apiRequest(`/menu/${encodeURIComponent(menuItemId)}`, { method: 'PATCH', body: input });
                    await refreshRemoteState();
                    return result.menuItem;
                },
                toggleMenuItemAvailability: async (menuItemId) => {
                    const item = menuItems.find(current => String(current.id) === String(menuItemId));
                    if (!item) throw new Error('Menu item not found.');
                    const available = item.available === false;
                    await apiRequest(`/menu/${encodeURIComponent(menuItemId)}`, { method: 'PATCH', body: { available } });
                    await refreshRemoteState();
                    return available;
                },
                updateRestaurantSettings: async (settings) => {
                    const result = await apiRequest('/settings', { method: 'PATCH', body: settings });
                    await refreshRemoteState();
                    return { ok: true, settings: result.settings };
                },
                addRestaurantTable: async (input) => {
                    const result = await apiRequest('/tables', { method: 'POST', body: input });
                    await refreshRemoteState();
                    return result.table;
                },
                updateRestaurantTable: async (tableId, changes) => {
                    const result = await apiRequest(`/tables/${encodeURIComponent(tableId)}`, { method: 'PATCH', body: changes });
                    await refreshRemoteState();
                    return result.table;
                },
                setRestaurantTableStatus: async (tableId, status) => {
                    const result = await apiRequest(`/tables/${encodeURIComponent(tableId)}`, { method: 'PATCH', body: { status } });
                    await refreshRemoteState();
                    return result.table;
                },
                toggleRestaurantTableActive: async (tableId) => {
                    const table = tables.find(current => String(current.id) === String(tableId));
                    if (!table) throw new Error('Table not found.');
                    const result = await apiRequest(`/tables/${encodeURIComponent(tableId)}`, { method: 'PATCH', body: { active: table.active === false } });
                    await refreshRemoteState();
                    return result.table;
                },
                addWaiterAccount: async (...args) => {
                    const input = args[0] || {};
                    const existingProfile = waiters.find(waiter => waiter.username.toLowerCase() === String(input.username || '').trim().toLowerCase());
                    await apiRequest('/users', { method: 'POST', body: { username: input.username, name: input.name, password: input.password, role: 'Waiter' } });
                    const refreshed = await refreshRemoteState();
                    return refreshed.waiters.find(waiter => waiter.username.toLowerCase() === (existingProfile?.username || input.username).toLowerCase());
                },
                addKitchenStaffAccount: async (input) => {
                    const { user } = await apiRequest('/users', { method: 'POST', body: { username: input.username, name: input.name, password: input.password, role: 'Kitchen Staff' } });
                    setKitchenStaff(previous => [...previous.filter(account => account.id !== user.id), user]);
                    return user;
                },
                addManagerAccount: async (input) => {
                    const { user } = await apiRequest('/users', { method: 'POST', body: { username: input.username, name: input.name, password: input.password, role: 'Manager' } });
                    setManagerAccounts(previous => [...previous.filter(account => account.id !== user.id), user]);
                    return user;
                },
                updateWaiterAccountStatus: async (...args) => {
                    const waiter = waiters.find(item => item.id === args[0]);
                    if (waiter) {
                        const { users = [] } = await apiRequest('/users');
                        const account = users.find(user => user.username.toLowerCase() === waiter.username.toLowerCase());
                        if (account) await apiRequest(`/users/${account._id || account.id}`, { method: 'PATCH', body: { active: args[1] } });
                    }
                    const result = await refreshRemoteState();
                    if (args[1] === false && typeof CustomEvent !== "undefined") {
                        globalThis.dispatchEvent?.(new CustomEvent("restaurant-waiter-account-change", {
                            detail: { waiterId: args[0], active: false }
                        }));
                    }
                    return result.waiters?.find(item => item.id === args[0]);
                },
                assignOrderWaiter: async (orderId, waiterId) => {
                    const result = await apiRequest(`/orders/${encodeURIComponent(orderId)}/assignment`, { method: 'PATCH', body: { waiterId } });
                    await refreshRemoteState();
                    return result.order;
                },
                markNotificationRead: async (notificationId) => {
                    const result = await apiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH', body: {} });
                    await refreshRemoteState();
                    return result.notification;
                },
                createOrder: async (input) => {
                    const result = await apiRequest('/orders', { method: 'POST', body: input });
                    await refreshRemoteState();
                    return result.order;
                },
                addItemsToOrder: async (orderId, items) => {
                    const result = await apiRequest(`/orders/${encodeURIComponent(orderId)}/items`, { method: 'POST', body: { items } });
                    await refreshRemoteState();
                    return result.kot;
                },
                updateKotStatus: async (kotId, status, cancellationReason = '') => {
                    const result = await apiRequest(`/kots/${encodeURIComponent(kotId)}/status`, { method: 'PATCH', body: { status, reason: cancellationReason } });
                    await refreshRemoteState();
                    return result.kot;
                },
                serveKot: async (kotId) => {
                    const result = await apiRequest(`/kots/${encodeURIComponent(kotId)}/status`, { method: 'PATCH', body: { status: 'Served' } });
                    await refreshRemoteState();
                    return result.kot;
                },
                cancelKotItem: async (kotId, lineId, quantity, reason) => {
                    const result = await apiRequest(`/kots/${encodeURIComponent(kotId)}/items/${encodeURIComponent(lineId)}/cancellations`, { method: 'POST', body: { quantity, reason } });
                    await refreshRemoteState();
                    return result.kot;
                },
                updateOrderStatus: async (orderId, status, options = {}) => {
                    const result = await apiRequest(`/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', body: { status, ...options } });
                    await refreshRemoteState();
                    return result.order;
                },
                setBillDiscount: async (orderId, discount) => {
                    const result = await apiRequest(`/billing/${encodeURIComponent(orderId)}/discount`, { method: 'PATCH', body: { discount } });
                    await refreshRemoteState();
                    return result.bill;
                },
                recordPayment: async (orderId, paymentInput) => {
                    const idempotencyKey = paymentInput.idempotencyKey || globalThis.crypto?.randomUUID?.() || `payment_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                    const result = await apiRequest(`/billing/${encodeURIComponent(orderId)}/payments`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: paymentInput });
                    await refreshRemoteState();
                    return result.payment;
                },
                updateBillStatus: async (billId, status) => {
                    const bill = bills.find(item => item.id === billId);
                    if (!bill) throw new Error('Bill not found.');
                    const result = await apiRequest(`/billing/${encodeURIComponent(bill.orderId)}/status`, { method: 'PATCH', body: { status } });
                    await refreshRemoteState();
                    return result.bill;
                },
                settleZeroBalanceBill: async (billId) => {
                    const bill = bills.find(item => item.id === billId);
                    if (!bill) throw new Error('Bill not found.');
                    const result = await apiRequest(`/billing/${encodeURIComponent(bill.orderId)}/discount`, { method: 'PATCH', body: { discount: bill.discount } });
                    await refreshRemoteState();
                    return result.bill;
                }
            }}
        >
            {children}
        </RestaurantContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRestaurant() {
    const context = useContext(RestaurantContext);

    if (!context) {
        throw new Error("useRestaurant must be used within a RestaurantProvider.");
    }

    return context;
}
