import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";
import { getCompletedPaymentTotal } from "../utils/payments";
import { useAuth } from "../Context/useAuth";

function formatRupees(amount, currency = "INR") {
    const value = Number(amount);
    return Number.isFinite(value) ? new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(value) : "—";
}

function formatDateTime(value) {
    if (!value) {
        return "Date unavailable";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function getOrderLabel(order) {
    return order.orderNumber ?? order.id ?? "Unknown";
}

function getOrderItemPrice(item) {
    return Number(item.unitPrice ?? item.price);
}

function Orders() {
    const {
        orders,
        kots,
        bills,
        payments,
        menuItems,
        restaurantSettings,
        addItemsToOrder,
        cancelKotItem,
        updateOrderStatus,
        serveKot,
        waiters,
        assignOrderWaiter
    } = useRestaurant();
    const { can, user } = useAuth();
    const [searchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const focusedOrderId = searchParams.get("orderId");
    const currency = restaurantSettings.currency || "INR";

    const [showHistory, setShowHistory] = useState(false);
    const [itemDrafts, setItemDrafts] = useState({});
    const [busyOrders, setBusyOrders] = useState({});
    const [feedbackByOrder, setFeedbackByOrder] = useState({});
    const [itemCancellationDrafts, setItemCancellationDrafts] = useState({});
    const busyOrderIds = useRef(new Set());

    function setOrderFeedback(orderId, type, message) {
        const key = String(orderId);
        setFeedbackByOrder(previous => ({
            ...previous,
            [key]: { type, message }
        }));
    }

    function clearOrderFeedback(orderId) {
        const key = String(orderId);
        setFeedbackByOrder(previous => {
            if (!previous[key]) {
                return previous;
            }

            const next = { ...previous };
            delete next[key];
            return next;
        });
    }

    function setOrderBusy(orderId, isBusy) {
        const key = String(orderId);
        setBusyOrders(previous => ({
            ...previous,
            [key]: isBusy
        }));
    }

    function addMenuItemToDraft(orderId, menuItem) {
        clearOrderFeedback(orderId);

        if (typeof menuItem.name !== "string" || menuItem.name.trim() === "") {
            setOrderFeedback(orderId, "error", "This menu item does not have a valid name.");
            return;
        }
        if ((typeof menuItem.price !== "number" && typeof menuItem.price !== "string") ||
            (typeof menuItem.price === "string" && menuItem.price.trim() === "")) {
            setOrderFeedback(orderId, "error", `${menuItem.name} does not have a valid price.`);
            return;
        }

        const price = Number(menuItem.price);
        if (!Number.isFinite(price) || price < 0) {
            setOrderFeedback(orderId, "error", `${menuItem.name} does not have a valid price.`);
            return;
        }

        const itemSnapshot = {
            menuItemId: menuItem.id ?? null,
            name: menuItem.name.trim(),
            unitPrice: Math.round((price + Number.EPSILON) * 100) / 100,
            quantity: 1,
            notes: ""
        };
        const orderKey = String(orderId);
        const itemKey = itemSnapshot.menuItemId ?? itemSnapshot.name;

        setItemDrafts(previous => {
            const currentDraft = previous[orderKey] || [];
            const existingItem = currentDraft.find(item =>
                (item.menuItemId ?? item.name) === itemKey
            );
            const nextDraft = existingItem
                ? currentDraft.map(item =>
                    (item.menuItemId ?? item.name) === itemKey
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                )
                : [...currentDraft, itemSnapshot];

            return { ...previous, [orderKey]: nextDraft };
        });
    }

    function changeDraftQuantity(orderId, itemKey, change) {
        clearOrderFeedback(orderId);
        const orderKey = String(orderId);

        setItemDrafts(previous => {
            const currentDraft = previous[orderKey] || [];
            const nextDraft = currentDraft
                .map(item => (item.menuItemId ?? item.name) === itemKey
                    ? { ...item, quantity: item.quantity + change }
                    : item
                )
                .filter(item => item.quantity > 0);

            return { ...previous, [orderKey]: nextDraft };
        });
    }

    function getBillForOrder(order) {
        return bills.find(bill =>
            bill.orderId === order.id && (!order.billId || bill.id === order.billId)
        ) || bills.find(bill => bill.orderId === order.id);
    }

    function getOutstandingAmount(bill, orderId) {
        const paid = getCompletedPaymentTotal(payments, orderId, bill.id);
        return Math.max(0, Number(bill.grandTotal || 0) - paid);
    }

    async function submitAdditionalItems(order) {
        const orderKey = String(order.id);
        const draftItems = itemDrafts[orderKey] || [];

        if (busyOrderIds.current.has(orderKey)) {
            return;
        }
        clearOrderFeedback(order.id);

        if (!["Open", "In Progress"].includes(order.status)) {
            setOrderFeedback(order.id, "error", "Items can only be added to an open order.");
            return;
        }

        const bill = getBillForOrder(order);
        if (!bill || bill.status !== "Open") {
            setOrderFeedback(order.id, "error", "Items can only be added while the order has an open bill.");
            return;
        }

        const validItems = draftItems.length > 0 && draftItems.every(item =>
            typeof item.name === "string" &&
            item.name.trim() !== "" &&
            Number.isFinite(item.unitPrice) &&
            item.unitPrice >= 0 &&
            Number.isSafeInteger(item.quantity) &&
            item.quantity > 0
        );
        if (!validItems) {
            setOrderFeedback(order.id, "error", "Add at least one valid item with a positive quantity.");
            return;
        }

        busyOrderIds.current.add(orderKey);
        setOrderBusy(order.id, true);

        try {
            const createdKot = await addItemsToOrder(order.id, draftItems.map(item => ({
                menuItemId: item.menuItemId,
                name: item.name,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                notes: item.notes
            })));

            if (createdKot instanceof Error) {
                throw createdKot;
            }
            if (!createdKot || createdKot.error || createdKot.ok === false) {
                const returnedError = createdKot?.error;
                throw new Error(
                    (typeof returnedError === "string" ? returnedError : returnedError?.message) ||
                    "The additional items could not be added. Please try again."
                );
            }

            setItemDrafts(previous => ({ ...previous, [orderKey]: [] }));
            setOrderFeedback(
                order.id,
                "success",
                `KOT #${createdKot.sequence ?? createdKot.kotNumber ?? "added"} added to this order.`
            );
        } catch (error) {
            setOrderFeedback(
                order.id,
                "error",
                error?.message || "Unable to add items to this order. Please try again."
            );
        } finally {
            busyOrderIds.current.delete(orderKey);
            setOrderBusy(order.id, false);
        }
    }

    function markKotServed(order, kot) {
        const orderKey = String(order.id);
        if (busyOrderIds.current.has(orderKey)) return;
        busyOrderIds.current.add(orderKey);
        setOrderBusy(order.id, true);
        clearOrderFeedback(order.id);
        try {
            serveKot(kot.id);
            setOrderFeedback(order.id, "success", `KOT #${kot.sequence ?? kot.kotNumber ?? ""} marked as Served.`);
        } catch (error) {
            setOrderFeedback(order.id, "error", error?.message || "Unable to mark this KOT as Served.");
        } finally {
            busyOrderIds.current.delete(orderKey);
            setOrderBusy(order.id, false);
        }
    }

    async function changeOrderStatus(order, nextStatus) {
        const orderKey = String(order.id);

        if (busyOrderIds.current.has(orderKey)) {
            return;
        }
        clearOrderFeedback(order.id);

        if (!["Open", "In Progress"].includes(order.status) || !["Completed", "Cancelled"].includes(nextStatus)) {
            setOrderFeedback(order.id, "error", "This order status transition is not available.");
            return;
        }

        let options = {};
        if (nextStatus === "Completed") {
            const orderKots = kots.filter(kot => kot.orderId === order.id);
            const unserved = orderKots.filter(kot => !["Served", "Cancelled"].includes(kot.status));
            const bill = getBillForOrder(order);
            const paid = bill ? getCompletedPaymentTotal(payments, order.id, bill.id) : 0;
            const outstanding = bill ? Math.max(0, Number(bill.grandTotal || 0) - paid) : 0;
            const blockers = [];
            if (unserved.length) blockers.push(`${unserved.length} KOT(s) are not Served`);
            if (!bill || bill.status !== "Settled" || outstanding > 0.005) blockers.push(`unpaid balance ${formatRupees(outstanding, currency)}`);
            if (blockers.length) {
                const reason = window.prompt(`Normal completion is blocked: ${blockers.join("; ")}. Enter a reason for the Manager/Owner override:`);
                if (!reason?.trim()) {
                    setOrderFeedback(order.id, "error", "Completion override requires a reason.");
                    return;
                }
                if (!window.confirm(`Confirm exceptional completion? ${blockers.join("; ")}. Reason: ${reason.trim()}`)) return;
                options = { override: true, overrideReason: reason.trim() };
            }
        } else {
            const reason = window.prompt("Enter the reason for cancelling this order:");
            if (!reason?.trim()) {
                setOrderFeedback(order.id, "error", "Order cancellation requires a reason.");
                return;
            }
            if (!window.confirm(`Cancel this order and resolve its active KOTs? Reason: ${reason.trim()}`)) return;
            options = { reason: reason.trim() };
        }

        busyOrderIds.current.add(orderKey);
        setOrderBusy(order.id, true);

        try {
            await updateOrderStatus(order.id, nextStatus, options);
            setOrderFeedback(
                order.id,
                "success",
                nextStatus === "Completed" ? "Order completed." : "Order cancelled."
            );
        } catch (error) {
            setOrderFeedback(
                order.id,
                "error",
                error?.message || "Unable to update the order status."
            );
        } finally {
            busyOrderIds.current.delete(orderKey);
            setOrderBusy(order.id, false);
        }
    }

    async function submitItemCancellation(order, kot, item) {
        const draft = itemCancellationDrafts[item.lineId] || { quantity: "1", reason: "" };
        const quantity = Number(draft.quantity);
        try {
            await cancelKotItem(kot.id, item.lineId, quantity, draft.reason);
            setItemCancellationDrafts(previous => ({ ...previous, [item.lineId]: { quantity: "1", reason: "" } }));
            setOrderFeedback(order.id, "success", `${quantity} ${item.name} cancelled and the bill was recalculated.`);
        } catch (error) {
            setOrderFeedback(order.id, "error", error?.message || "Unable to cancel this item quantity.");
        }
    }

    const visibleOrders = can("orders:viewAssigned")
        ? orders.filter(order => order.assignedWaiter?.userId === user?.id)
        : orders;
    const visibleActiveOrders = visibleOrders.filter(order => !["Completed", "Cancelled"].includes(order.status));
    const visibleClosedOrders = visibleOrders.filter(order => ["Completed", "Cancelled"].includes(order.status));
    const baseOrders = focusedOrderId
        ? visibleOrders.filter(order => String(order.id) === focusedOrderId)
        : (showHistory ? visibleClosedOrders : visibleActiveOrders);
    const displayedOrders = baseOrders.filter(order =>
        [order.orderNumber, order.id, order.customerName, order.customerPhone, order.orderType, order.tableId ?? order.table]
            .filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase())
    );
    const availableMenuItems = menuItems.filter(item => item.available);

    return (
        <div className="page">
            <h1>Orders</h1>
            <p>View orders, their kitchen tickets, and current bill status.</p>

            <div className="order-actions">
                {can("orders:create") && <Link to="/orders/new">+ New Order</Link>}
                {!focusedOrderId && <button type="button" onClick={() => setShowHistory(previous => !previous)}>
                    {showHistory ? "Active Orders" : "Order History"}
                </button>}
                <label className="toolbar-search">Search orders<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Order, customer, phone, table" /></label>
                {focusedOrderId && <Link to="/orders">Show all orders</Link>}
            </div>

            <div className="orders-list">
                <h2>{showHistory ? "Completed and Cancelled Orders" : "Open Orders"}</h2>

                {displayedOrders.length === 0 ? (
                    <p>
                        {showHistory
                            ? "No completed or cancelled orders yet."
                            : "No open orders. Create a new order to get started."}
                    </p>
                ) : (
                    displayedOrders.map(order => {
                        const orderKey = String(order.id);
                        const bill = getBillForOrder(order);
                        const orderKots = kots
                            .filter(kot => kot.orderId === order.id)
                            .sort((first, second) =>
                                (first.sequence ?? first.kotNumber ?? 0) -
                                (second.sequence ?? second.kotNumber ?? 0)
                            );
                        const draftItems = itemDrafts[orderKey] || [];
                        const feedback = feedbackByOrder[orderKey];
                        const isBusy = Boolean(busyOrders[orderKey]);
                        const isDineIn = order.orderType === "DineIn";
                        const itemSubtotal = Number(order.total);

                        return (
                            <article className="order-card" key={order.id}>
                                <h3>Order #{getOrderLabel(order)}</h3>
                                <p><strong>Customer:</strong> {order.customerName || "Name not provided"}</p>
                                <p><strong>Phone:</strong> {order.customerPhone || "Phone not provided"}</p>
                                <p><strong>Type:</strong> {isDineIn ? "Dine-in" : order.orderType || "Not specified"}</p>
                                {isDineIn && (
                                    <p><strong>Table:</strong> {order.tableId ?? order.table ?? "Not assigned"}</p>
                                )}
                                <p><strong>Order status:</strong> {order.status || "Unknown"}</p>
                                {can("billing:view") && <p><strong>Payment status:</strong> {order.paymentStatus || "Unpaid"}</p>}
                                {order.status === "Completed" && <p className="order-section">
                                    <strong>Completion:</strong> {order.completionType || "Legacy"}{order.completionReason ? ` · ${order.completionReason}` : ""}
                                    <br /><strong>Completed:</strong> {formatDateTime(order.completedAt)}{order.completedBy?.name ? ` · ${order.completedBy.name}` : ""}
                                </p>}
                                {order.status === "Cancelled" && <p className="order-section">
                                    <strong>Cancellation:</strong> {order.cancellationReason || "Legacy cancellation"}
                                    <br /><strong>Cancelled:</strong> {formatDateTime(order.cancelledAt)}{order.cancelledBy?.name ? ` · ${order.cancelledBy.name}` : ""}
                                </p>}
                                <p><strong>Created:</strong> {formatDateTime(order.createdAt)}</p>
                                <p><strong>Created by:</strong> {order.createdBy?.name || "Legacy order"}</p>
                                <p><strong>Assigned waiter:</strong> {order.assignedWaiter?.name || "Unassigned"}</p>
                                {can("waiters:manage") && <label className="order-waiter-assignment" htmlFor={`order-waiter-${order.id}`}>
                                    Assign waiter
                                    <select id={`order-waiter-${order.id}`} value={order.assignedWaiter?.userId || ""} onChange={event => {
                                        try {
                                            assignOrderWaiter(order.id, event.target.value || null);
                                            setOrderFeedback(order.id, "success", event.target.value ? "Waiter assignment updated." : "Order marked unassigned.");
                                        } catch (error) {
                                            setOrderFeedback(order.id, "error", error.message || "Unable to update the Waiter assignment.");
                                        }
                                    }}>
                                        <option value="">Unassigned</option>
                                        {waiters.filter(waiter => waiter.active !== false).map(waiter => <option key={waiter.id} value={waiter.id}>{waiter.name}</option>)}
                                    </select>
                                </label>}

                                {!can("billing:view") ? (
                                    <p className="order-section">Billing details are available to Cashier, Manager and Owner roles.</p>
                                ) : bill ? (
                                    <div className="order-section">
                                        <h4>Consolidated Bill</h4>
                                        <p><strong>Bill status:</strong> {bill.status || "Unknown"}</p>
                                        <p><strong>Subtotal:</strong> {formatRupees(bill.subtotal ?? itemSubtotal, currency)}</p>
                                        <p><strong>GST:</strong> {formatRupees(bill.taxAmount, currency)}</p>
                                        <p><strong>Grand total:</strong> {formatRupees(bill.grandTotal, currency)}</p>
                                        <p><strong>Outstanding:</strong> {formatRupees(getOutstandingAmount(bill, order.id), currency)}</p>
                                        {can("billing:view") && <Link className="text-link" to={`/billing?orderId=${encodeURIComponent(order.id)}`}>Open bill</Link>}
                                    </div>
                                ) : (
                                    <p role="status">Bill information is unavailable for this order.</p>
                                )}

                                <details className="order-section">
                                    <summary>View order details and KOTs ({orderKots.length})</summary>
                                    <div className="order-details-content">
                                        <h4>Order item snapshot</h4>
                                        {Array.isArray(order.items) && order.items.length > 0 ? (
                                            order.items.map((item, index) => {
                                                const unitPrice = getOrderItemPrice(item);
                                                return (
                                                    <p key={`${item.menuItemId ?? item.name ?? "item"}-${index}`}>
                                                        {item.name || "Unnamed item"} × {item.quantity ?? 0}
                                                        {can("billing:view") && Number.isFinite(unitPrice) && (
                                                            <> — {formatRupees(unitPrice * Number(item.quantity || 0), currency)}</>
                                                        )}
                                                    </p>
                                                );
                                            })
                                        ) : (
                                            <p>No item snapshots are available.</p>
                                        )}

                                        <h4>Kitchen Order Tickets</h4>
                                        {orderKots.length === 0 ? (
                                            <p>No KOTs are linked to this order.</p>
                                        ) : (
                                            orderKots.map((kot, index) => {
                                                const sequence = kot.sequence ?? kot.kotNumber ?? index + 1;
                                                const kotItems = Array.isArray(kot.items) ? kot.items : [];
                                                return (
                                                    <section className="order-section" key={kot.id}>
                                                        <h4>
                                                            KOT #{sequence} — {sequence === 1 ? "Original KOT" : "Additional KOT"}
                                                        </h4>
                                                        <p><strong>Status:</strong> {kot.status || "Unknown"}</p>
                                                        {kot.status === "Served" && <p><strong>Served:</strong> {formatDateTime(kot.servedAt)}{kot.servedBy?.name ? ` · ${kot.servedBy.name}` : ""}</p>}
                                                        {kot.status === "Ready" && ["Open", "In Progress"].includes(order.status) &&
                                                            can("kitchen:serve") &&
                                                            (!can("orders:viewAssigned") || order.assignedWaiter?.userId === user?.id) && (
                                                                <button type="button" onClick={() => markKotServed(order, kot)} disabled={isBusy}>
                                                                    {isBusy ? "Updating…" : "Mark as Served"}
                                                                </button>
                                                            )}
                                                        {kotItems.length === 0 ? (
                                                            <p>No items on this KOT.</p>
                                                        ) : (
                                                            kotItems.map((item, itemIndex) => {
                                                                const unitPrice = getOrderItemPrice(item);
                                                                const remainingQuantity = Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0));
                                                                const cancellationDraft = itemCancellationDrafts[item.lineId] || { quantity: "1", reason: "" };
                                                                const canCancelItem = can("kitchen:cancel") && bill?.status === "Open" &&
                                                                    ["Open", "In Progress"].includes(order.status) &&
                                                                    !["Served", "Cancelled", "Closed"].includes(kot.status) && remainingQuantity > 0;
                                                                return (
                                                                    <div key={item.lineId ?? `${item.menuItemId ?? item.name ?? "kot-item"}-${itemIndex}`}>
                                                                        <p>
                                                                            {item.name || "Unnamed item"} × {remainingQuantity} active
                                                                            {Number(item.cancelledQuantity || 0) > 0 && ` · ${item.cancelledQuantity} cancelled of ${item.quantity}`}
                                                                            {can("billing:view") && Number.isFinite(unitPrice) && (
                                                                                <> — {formatRupees(unitPrice * remainingQuantity, currency)}</>
                                                                            )}
                                                                        </p>
                                                                        {item.notes && (
                                                                            <p><strong>Notes:</strong> {item.notes}</p>
                                                                        )}
                                                                        {(item.cancellations || []).map(cancellation => <p key={cancellation.id} className="kitchen-cancel-reason">
                                                                            <strong>Cancelled × {cancellation.quantity}:</strong> {cancellation.reason}
                                                                            {cancellation.actor?.name ? ` · ${cancellation.actor.name}` : ""}
                                                                            {cancellation.timestamp ? ` · ${formatDateTime(cancellation.timestamp)}` : ""}
                                                                        </p>)}
                                                                        {canCancelItem && <form className="inline-form" onSubmit={event => {
                                                                            event.preventDefault();
                                                                            submitItemCancellation(order, kot, item);
                                                                        }}>
                                                                            <label>Cancel quantity
                                                                                <input type="number" min="1" max={remainingQuantity} step="1" required
                                                                                    value={cancellationDraft.quantity}
                                                                                    onChange={event => setItemCancellationDrafts(previous => ({
                                                                                        ...previous,
                                                                                        [item.lineId]: { ...cancellationDraft, quantity: event.target.value }
                                                                                    }))} />
                                                                            </label>
                                                                            <label>Reason
                                                                                <input type="text" maxLength="240" required value={cancellationDraft.reason}
                                                                                    onChange={event => setItemCancellationDrafts(previous => ({
                                                                                        ...previous,
                                                                                        [item.lineId]: { ...cancellationDraft, reason: event.target.value }
                                                                                    }))} />
                                                                            </label>
                                                                            <button className="danger-button" type="submit">Cancel item quantity</button>
                                                                        </form>}
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </section>
                                                );
                                            })
                                        )}
                                    </div>
                                </details>

                                {feedback && (
                                    <p
                                        className={feedback.type === "error" ? "form-error" : "form-success"}
                                        role={feedback.type === "error" ? "alert" : "status"}
                                        aria-live={feedback.type === "error" ? "assertive" : "polite"}
                                    >
                                        {feedback.message}
                                    </p>
                                )}

                                {["Open", "In Progress"].includes(order.status) && can("orders:manage") && (
                                    <div className="order-actions">
                                        <button
                                            type="button"
                                            onClick={() => changeOrderStatus(order, "Completed")}
                                            disabled={isBusy || !bill || bill.status === "Void"}
                                        >
                                            {isBusy ? "Updating…" : "Complete Order"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => changeOrderStatus(order, "Cancelled")}
                                            disabled={isBusy}
                                        >
                                            Cancel Order
                                        </button>
                                    </div>
                                )}

                                {["Open", "In Progress"].includes(order.status) && bill?.status === "Open" && can("orders:addItems") && (
                                    <details className="order-section">
                                        <summary>Add items to this order</summary>
                                        <p>Added items will be sent as a new KOT on this order.</p>

                                        {availableMenuItems.length === 0 ? (
                                            <p>No menu items are currently available.</p>
                                        ) : (
                                            <div className="food-items">
                                                {availableMenuItems.map(menuItem => (
                                                    <button
                                                        type="button"
                                                        key={menuItem.id ?? menuItem.name}
                                                        onClick={() => addMenuItemToDraft(order.id, menuItem)}
                                                        disabled={isBusy}
                                                    >
                                                        Add {menuItem.name} — {formatRupees(Number(menuItem.price), currency)}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {draftItems.length > 0 && (
                                            <div className="selected-items">
                                                <h4>New KOT items</h4>
                                                {draftItems.map(item => {
                                                    const itemKey = item.menuItemId ?? item.name;
                                                    return (
                                                        <div key={itemKey}>
                                                            <p>{item.name} — {formatRupees(item.unitPrice, currency)} each</p>
                                                            <button
                                                                type="button"
                                                                aria-label={`Decrease ${item.name} quantity`}
                                                                onClick={() => changeDraftQuantity(order.id, itemKey, -1)}
                                                                disabled={isBusy}
                                                            >
                                                                −
                                                            </button>
                                                            <span>{item.quantity}</span>
                                                            <button
                                                                type="button"
                                                                aria-label={`Increase ${item.name} quantity`}
                                                                onClick={() => changeDraftQuantity(order.id, itemKey, 1)}
                                                                disabled={isBusy}
                                                            >
                                                                +
                                                            </button>
                                                            <p>Item Total: {formatRupees(item.unitPrice * item.quantity, currency)}</p>
                                                            <label>
                                                                Special instructions for {item.name}
                                                                <input type="text" maxLength="240" value={item.notes || ""}
                                                                    onChange={event => setItemDrafts(previous => ({
                                                                        ...previous,
                                                                        [orderKey]: draftItems.map(current => (current.menuItemId ?? current.name) === itemKey
                                                                            ? { ...current, notes: event.target.value }
                                                                            : current)
                                                                    }))} disabled={isBusy} />
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => changeDraftQuantity(order.id, itemKey, -item.quantity)}
                                                                disabled={isBusy}
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                                <button
                                                    type="button"
                                                    onClick={() => submitAdditionalItems(order)}
                                                    disabled={isBusy}
                                                >
                                                    {isBusy ? "Adding items…" : "Add as New KOT"}
                                                </button>
                                            </div>
                                        )}
                                    </details>
                                )}
                            </article>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default Orders;
