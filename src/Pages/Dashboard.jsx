import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import DashboardCard from "../Components/DashboardCard";
import { useRestaurant } from "../Context/RestaurantContext";
import { getCompletedPaymentTotal } from "../utils/payments";
import { getPaymentAppliedAmount } from "../utils/payments";
import { useAuth } from "../Context/useAuth";

function money(value, currency = "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(value) || 0);
}

function Dashboard() {
    const { orders, tables, kots, bills, payments, restaurantSettings, notifications, markNotificationRead, serveKot } = useRestaurant();
    const { can, user } = useAuth();
    const [servingKotId, setServingKotId] = useState(null);
    const [serviceFeedback, setServiceFeedback] = useState(null);
    if (user?.role === "Kitchen Staff") return <Navigate to="/kitchen" replace />;
    const showFinancials = can("dashboard:financial");
    const assignedOrders = can("orders:viewAssigned")
        ? orders.filter(order => order.assignedWaiter?.userId === user?.id)
        : orders;
    const today = new Date().toLocaleDateString("en-CA");
    const todayOrders = assignedOrders.filter(order => (order.createdAt || "").slice(0, 10) === today);
    const todaySales = payments.filter(payment => payment.status === "Completed" &&
        (payment.timestamp || payment.createdAt || "").slice(0, 10) === today)
        .reduce((sum, payment) => sum + getPaymentAppliedAmount(payment), 0);
    const activeOrders = assignedOrders.filter(order => ["Open", "In Progress"].includes(order.status));
    const completedOrders = todayOrders.filter(order => order.status === "Completed").length;
    const visibleKots = kots.filter(kot => activeOrders.some(order => order.id === kot.orderId));
    const pendingKots = visibleKots.filter(kot => ["Queued", "Preparing"].includes(kot.status)).length;
    const openBills = bills.filter(bill => bill.status === "Open");
    const paymentTotal = bill => getCompletedPaymentTotal(payments, bill.orderId, bill.id);
    const unpaidBills = openBills.filter(bill => paymentTotal(bill) <= 0).length;
    const partialBills = openBills.filter(bill => paymentTotal(bill) > 0 && paymentTotal(bill) < Number(bill.grandTotal || 0)).length;
    const availableTables = tables.filter(table => table.active !== false && table.status === "Available").length;
    const occupiedTables = tables.filter(table => table.active !== false && table.status === "Occupied").length;
    const recentOrders = [...assignedOrders].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5);
    const personalNotifications = can("notifications:own")
        ? notifications.filter(item => item.recipientUserId === user?.id && !item.resolvedAt)
        : can("notifications:manage")
            ? notifications.filter(item => item.recipientUserId == null && !item.resolvedAt)
            : [];
    const unassignedReadyKots = can("notifications:manage")
        ? kots.filter(kot => kot.status === "Ready" && activeOrders.some(order => order.id === kot.orderId) && !orders.find(order => order.id === kot.orderId)?.assignedWaiter?.userId)
        : [];
    const unassignedOrders = can("waiters:manage")
        ? orders.filter(order => ["Open", "In Progress"].includes(order.status) && !order.assignedWaiter?.userId)
        : [];
    const readyKotsForService = can("kitchen:serve")
        ? kots.filter(kot => kot.status === "Ready" && activeOrders.some(order => order.id === kot.orderId))
        : [];
    const recentlyServedKots = can("orders:viewAssigned")
        ? kots.filter(kot => kot.status === "Served" && assignedOrders.some(order => order.id === kot.orderId)).slice(-8).reverse()
        : [];

    function confirmKotServed(kot) {
        setServiceFeedback(null);
        setServingKotId(kot.id);
        try {
            serveKot(kot.id);
            setServiceFeedback({ type: "success", message: `KOT #${kot.sequence ?? kot.kotNumber ?? ""} marked as Served.` });
        } catch (error) {
            setServiceFeedback({ type: "error", message: error?.message || "Unable to confirm service." });
        } finally {
            setServingKotId(null);
        }
    }

    return (
        <main className="dashboard">
            <h1>Dashboard</h1>
            <p>{showFinancials ? "Live restaurant activity and today’s collections." : "Your assigned service activity and table information."}</p>
            <div className="dashboard-cards">
                {showFinancials && <DashboardCard title="Today's Collections" value={money(todaySales, restaurantSettings.currency)} />}
                <DashboardCard title="Today's Orders" value={todayOrders.length} />
                <DashboardCard title="Active Orders" value={activeOrders.length} />
                <DashboardCard title="Completed Today" value={completedOrders} />
                <DashboardCard title="Available Tables" value={availableTables} />
                <DashboardCard title="Occupied Tables" value={occupiedTables} />
                <DashboardCard title="Pending KOTs" value={pendingKots} />
                {showFinancials && <DashboardCard title="Unpaid / Partial Bills" value={`${unpaidBills} / ${partialBills}`} />}
            </div>
            <section className="quick-actions">
                <h2>Quick actions</h2>
                <div className="action-buttons">
                    {can("orders:create") && <Link to="/orders/new">+ New order</Link>}
                    {can("orders:view") && <Link to="/orders">Orders</Link>}
                    {can("kitchen:view") && <Link to="/kitchen">Kitchen tickets</Link>}
                    {can("tables:view") && <Link to="/tables">Tables</Link>}
                    {can("billing:view") && <Link to="/billing">Billing</Link>}
                    {can("reports:limited") || can("reports:full") ? <Link to="/reports">Reports</Link> : null}
                </div>
            </section>
            <section className="recent-orders">
                <div className="section-heading"><h2>Recent orders</h2>{can("orders:view") && <Link to="/orders">View all</Link>}</div>
                {recentOrders.length === 0 ? <p className="empty-state">No orders have been created yet.</p> : <div className="recent-order-list">
                    {recentOrders.map(order => <Link className="recent-order-row" key={order.id} to={`/orders?orderId=${encodeURIComponent(order.id)}`}>
                        <span><strong>#{order.orderNumber ?? order.id}</strong><small>{order.customerName || "Customer not provided"} · {order.orderType || "Unknown"}</small></span>
                        <span className="recent-order-state">{order.status}{showFinancials ? ` · ${order.paymentStatus || "Unpaid"}` : ""}</span>
                    </Link>)}
                </div>}
            </section>
            {(can("notifications:own") || can("notifications:manage")) && <section className="recent-orders notifications-panel" aria-labelledby="notifications-title">
                <div className="section-heading">
                    <h2 id="notifications-title">{can("notifications:own") ? "Ready for pickup" : "Unassigned service alerts"}</h2>
                    <strong>{personalNotifications.filter(item => !item.readAt).length} unread</strong>
                </div>
                {personalNotifications.length === 0 && unassignedReadyKots.length === 0
                    ? <p className="empty-state">No Ready KOT notifications.</p>
                    : <div className="recent-order-list">
                        {personalNotifications.map(notification => <article className={`notification-row${notification.readAt ? " is-read" : ""}`} key={notification.id}>
                            <div>
                                <strong>{notification.title}</strong>
                                <p>{notification.message}</p>
                                <p>{(notification.items || []).map(item => `${item.name} × ${item.quantity}${item.notes ? ` · ${item.notes}` : ""}`).join(", ")}</p>
                                <small>{new Date(notification.createdAt).toLocaleString()}</small>
                            </div>
                            {!notification.readAt && (can("notifications:own") || notification.recipientUserId == null) && <button type="button" onClick={() => {
                                try { markNotificationRead(notification.id); } catch { /* The Context enforces ownership. */ }
                            }}>Mark read</button>}
                        </article>)}
                        {unassignedReadyKots.filter(kot => !personalNotifications.some(item => item.kotId === kot.id)).map(kot => {
                            const order = orders.find(item => item.id === kot.orderId);
                            return <article className="notification-row" key={`unassigned-${kot.id}`}>
                                <div>
                                    <strong>Unassigned KOT #{kot.sequence ?? kot.kotNumber ?? 1} ready</strong>
                                    <p>Order #{order?.orderNumber ?? order?.id} · {order?.orderType === "DineIn" ? `Table ${order.tableId ?? order.table ?? "Unassigned"}` : "Takeaway"}</p>
                                    <p>{(kot.items || []).map(item => `${item.name} × ${item.quantity}`).join(", ")}</p>
                                    <small>{new Date(kot.readyAt || kot.updatedAt || kot.createdAt).toLocaleString()}</small>
                                </div>
                                <Link to={`/orders?orderId=${encodeURIComponent(order?.id || "")}`}>Assign waiter</Link>
                            </article>;
                        })}
                    </div>}
            </section>}
            {can("kitchen:serve") && <section className="recent-orders service-queue" aria-labelledby="service-queue-title">
                <div className="section-heading"><h2 id="service-queue-title">KOTs awaiting service</h2><strong>{readyKotsForService.length}</strong></div>
                {serviceFeedback && <p className={serviceFeedback.type === "error" ? "form-error" : "form-success"} role={serviceFeedback.type === "error" ? "alert" : "status"}>{serviceFeedback.message}</p>}
                {readyKotsForService.length === 0 ? <p className="empty-state">No Ready KOTs are awaiting service.</p> : <div className="recent-order-list">
                    {readyKotsForService.map(kot => {
                        const order = orders.find(item => item.id === kot.orderId);
                        return <article className="notification-row" key={`service-${kot.id}`}>
                            <div>
                                <strong>Order #{order?.orderNumber ?? order?.id} · KOT #{kot.sequence ?? kot.kotNumber ?? 1}</strong>
                                <p>{order?.orderType === "DineIn" ? `Table ${order.tableId ?? order.table ?? "Unassigned"}` : "Takeaway"} · {kot.items.map(item => `${item.name} × ${Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0))}`).join(", ")}</p>
                            </div>
                            <button type="button" disabled={servingKotId !== null} onClick={() => confirmKotServed(kot)}>
                                {servingKotId === kot.id ? "Updating…" : "Mark as Served"}
                            </button>
                        </article>;
                    })}
                </div>}
            </section>}
            {recentlyServedKots.length > 0 && <section className="recent-orders" aria-labelledby="served-kots-title">
                <h2 id="served-kots-title">Recently served KOTs</h2>
                <div className="recent-order-list">{recentlyServedKots.map(kot => {
                    const order = orders.find(item => item.id === kot.orderId);
                    return <article className="recent-order-row" key={`served-${kot.id}`}>
                        <span><strong>Order #{order?.orderNumber ?? order?.id} · KOT #{kot.sequence ?? kot.kotNumber ?? 1}</strong><small>{kot.servedBy?.name || "Waiter unavailable"} · {kot.servedAt ? new Date(kot.servedAt).toLocaleString() : "Time unavailable"}</small></span>
                        <span className="recent-order-state">Served</span>
                    </article>;
                })}</div>
            </section>}
            {can("waiters:manage") && unassignedOrders.length > 0 && <section className="recent-orders">
                <h2>Unassigned open orders ({unassignedOrders.length})</h2>
                <p>Assign a Waiter from the order card.</p>
                <div className="recent-order-list">{unassignedOrders.map(order => <Link className="recent-order-row" key={order.id} to={`/orders?orderId=${encodeURIComponent(order.id)}`}>
                    <span><strong>#{order.orderNumber ?? order.id}</strong><small>{order.orderType === "DineIn" ? `Table ${order.tableId ?? order.table ?? "Unassigned"}` : "Takeaway"}</small></span>
                    <span className="recent-order-state">Unassigned</span>
                </Link>)}</div>
            </section>}
        </main>
    );
}

export default Dashboard;
