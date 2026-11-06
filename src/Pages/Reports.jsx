import { useMemo, useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";
import { getCompletedPaymentTotal, getPaymentAppliedAmount, getPaymentTipAmount } from "../utils/payments";
import { useAuth } from "../Context/useAuth";

function localDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function money(value, currency = "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(value) || 0);
}

function toMinor(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100);
}

function dateInRange(value, start, end) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return false;
    const day = localDate(date);
    return day >= start && day <= end;
}

function Reports() {
    const { orders, bills, payments, kots, menuItems, restaurantSettings } = useRestaurant();
    const { can } = useAuth();
    const today = new Date();
    const [rangeType, setRangeType] = useState("Daily");
    const [startDate, setStartDate] = useState(localDate(today));
    const [endDate, setEndDate] = useState(localDate(today));
    const isFull = can("reports:full");
    const canViewItemSales = can("reports:itemwise");
    const currency = restaurantSettings.currency || "INR";

    function chooseRange(value) {
        setRangeType(value);
        const end = new Date();
        let start = new Date(end);
        if (value === "Weekly") {
            start.setDate(end.getDate() - ((end.getDay() + 6) % 7));
        } else if (value === "Monthly") {
            start = new Date(end.getFullYear(), end.getMonth(), 1);
        } else if (value !== "Daily") {
            return;
        }
        setStartDate(localDate(start));
        setEndDate(localDate(end));
    }

    const reportPayments = useMemo(() => payments.filter(payment => payment.status === "Completed" &&
        dateInRange(payment.timestamp ?? payment.createdAt, startDate, endDate)), [payments, startDate, endDate]);
    const reportOrders = useMemo(() => orders.filter(order => dateInRange(order.createdAt, startDate, endDate)), [orders, startDate, endDate]);
    const reportBills = useMemo(() => bills.filter(bill => dateInRange(bill.createdAt, startDate, endDate)), [bills, startDate, endDate]);
    const totalCollectedMinor = reportPayments.reduce((sum, payment) => sum + toMinor(getPaymentAppliedAmount(payment)), 0);
    const tipsCollectedMinor = reportPayments.reduce((sum, payment) => sum + toMinor(getPaymentTipAmount(payment)), 0);
    const methodTotals = ["Cash", "UPI", "Card"].map(method => ({
        method,
        amountMinor: reportPayments.filter(payment => payment.method === method).reduce((sum, payment) => sum + toMinor(getPaymentAppliedAmount(payment)), 0)
    }));
    const maxMethodTotal = Math.max(1, ...methodTotals.map(item => item.amountMinor));
    const cancelledOrders = reportOrders.filter(order => order.status === "Cancelled");
    const openBills = bills.filter(bill => bill.status === "Open");
    const outstanding = openBills.map(bill => {
        const received = getCompletedPaymentTotal(payments, bill.orderId, bill.id);
        return { bill, dueMinor: Math.max(0, toMinor(bill.grandTotal || 0) - toMinor(received)) };
    }).filter(item => item.dueMinor > 0);
    const unpaidTotalMinor = outstanding.reduce((sum, item) => sum + item.dueMinor, 0);
    const billedSubtotalMinor = reportBills.filter(bill => bill.status !== "Void").reduce((sum, bill) => sum + toMinor(bill.subtotal), 0);
    const gstTotalMinor = reportBills.filter(bill => bill.status !== "Void").reduce((sum, bill) => sum + toMinor(bill.taxAmount), 0);

    const itemLifecycleByKey = new Map();
    kots.forEach(kot => {
        const order = orders.find(item => item.id === kot.orderId);
        if (!order || !dateInRange(kot.createdAt ?? order.createdAt, startDate, endDate)) return;

        (Array.isArray(kot.items) ? kot.items : []).forEach(item => {
            const itemName = String(item.name || "Unnamed item");
            const itemId = item.menuItemId ?? menuItems.find(menuItem => menuItem.name === itemName)?.id;
            const key = itemId != null ? `id:${itemId}` : `name:${itemName.trim().toLowerCase()}`;
            const orderedQuantity = Number(item.quantity);
            const unitPriceMinor = Math.round((Number(item.unitPrice ?? item.price) + Number.EPSILON) * 100);
            if (!Number.isSafeInteger(orderedQuantity) || orderedQuantity <= 0 || !Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) return;
            const partialCancelled = kot.status === "Cancelled"
                ? orderedQuantity
                : Math.min(orderedQuantity, Math.max(0, Number(item.cancelledQuantity || 0)));
            const activeQuantity = orderedQuantity - partialCancelled;
            const servedQuantity = kot.status === "Served" ? activeQuantity : 0;
            const menuSnapshotFallback = itemId == null ? null : menuItems.find(menuItem => String(menuItem.id) === String(itemId));
            const current = itemLifecycleByKey.get(key) || {
                key,
                menuItemId: itemId ?? null,
                name: itemName,
                category: item.category || menuSnapshotFallback?.category || "Uncategorized",
                orderedQuantity: 0,
                orderedRevenueMinor: 0,
                servedQuantity: 0,
                servedRevenueMinor: 0,
                cancelledQuantity: 0,
                cancelledRevenueMinor: 0,
                orderIds: new Set()
            };
            current.orderedQuantity += orderedQuantity;
            current.orderedRevenueMinor += unitPriceMinor * orderedQuantity;
            current.servedQuantity += servedQuantity;
            current.servedRevenueMinor += unitPriceMinor * servedQuantity;
            current.cancelledQuantity += partialCancelled;
            current.cancelledRevenueMinor += unitPriceMinor * partialCancelled;
            current.orderIds.add(order.id);
            itemLifecycleByKey.set(key, current);
        });
    });

    const itemSales = [...itemLifecycleByKey.values()].map(item => ({
        ...item,
        quantity: item.orderedQuantity,
        revenue: item.orderedRevenueMinor / 100,
        servedRevenue: item.servedRevenueMinor / 100,
        cancelledRevenue: item.cancelledRevenueMinor / 100,
        orderCount: item.orderIds.size
    }));
    const allItemRows = [...itemSales];
    menuItems.forEach(item => {
        const key = `id:${item.id}`;
        if (!itemLifecycleByKey.has(key)) {
            allItemRows.push({ key, menuItemId: item.id, name: item.name, category: item.category || "Uncategorized", quantity: 0, orderedQuantity: 0, revenue: 0, servedQuantity: 0, servedRevenue: 0, cancelledQuantity: 0, cancelledRevenue: 0, orderCount: 0 });
        }
    });
    const bestSellingItems = [...itemSales].sort((a, b) => b.orderedQuantity - a.orderedQuantity || b.revenue - a.revenue).slice(0, 5);
    const leastSellingItems = [...allItemRows].sort((a, b) => a.orderedQuantity - b.orderedQuantity || a.revenue - b.revenue).slice(0, 5);
    const totalItemQuantity = itemSales.reduce((sum, item) => sum + item.orderedQuantity, 0);
    const totalItemRevenueMinor = itemSales.reduce((sum, item) => sum + item.orderedRevenueMinor, 0);
    const totalServedQuantity = itemSales.reduce((sum, item) => sum + item.servedQuantity, 0);
    const totalServedRevenue = itemSales.reduce((sum, item) => sum + item.servedRevenue, 0);
    const totalCancelledQuantity = itemSales.reduce((sum, item) => sum + item.cancelledQuantity, 0);
    const totalCancelledRevenue = itemSales.reduce((sum, item) => sum + item.cancelledRevenue, 0);
    const categorySales = itemSales.reduce((summary, item) => {
        const current = summary.get(item.category) || { category: item.category, quantity: 0, revenueMinor: 0 };
        current.quantity += item.quantity;
        current.revenueMinor += item.orderedRevenueMinor;
        summary.set(item.category, current);
        return summary;
    }, new Map());

    return (
        <main className="page">
            <h1>Reports</h1>
            <p>Ordered value, served food, billed amounts, completed collections and tips are reported separately.</p>
            <div className="reports-toolbar">
                <label>Period<select value={rangeType} onChange={event => chooseRange(event.target.value)}>
                    <option>Daily</option><option>Weekly</option><option>Monthly</option><option>Custom</option>
                </select></label>
                <label>From<input type="date" value={startDate} onChange={event => { setRangeType("Custom"); setStartDate(event.target.value); }} /></label>
                <label>To<input type="date" value={endDate} min={startDate} onChange={event => { setRangeType("Custom"); setEndDate(event.target.value); }} /></label>
            </div>
            <div className="report-cards">
                <article className="report-card"><h3>Collected sales</h3><h2>{money(totalCollectedMinor / 100, currency)}</h2></article>
                <article className="report-card"><h3>Tips collected</h3><h2>{money(tipsCollectedMinor / 100, currency)}</h2></article>
                <article className="report-card"><h3>Orders in range</h3><h2>{reportOrders.length}</h2></article>
                <article className="report-card"><h3>Completed orders</h3><h2>{reportOrders.filter(order => order.status === "Completed").length}</h2></article>
                <article className="report-card"><h3>Cancelled orders</h3><h2>{cancelledOrders.length}</h2></article>
            </div>
            <div className="reports-grid">
                <section className="payment-report">
                    <h2>Collections by method</h2>
                    {methodTotals.map(item => <div className="report-method" key={item.method}>
                        <div><span>{item.method}</span><strong>{money(item.amountMinor / 100, currency)}</strong></div>
                        <div className="report-bar-track"><span style={{ width: `${item.amountMinor / maxMethodTotal * 100}%` }} /></div>
                    </div>)}
                    <p>{reportPayments.length} completed payment transactions in range.</p>
                    <p>Collections count bill-applied amounts only. Tips are shown separately.</p>
                </section>
                {isFull && <section className="payment-report">
                    <h2>GST summary</h2><p>Bill subtotal: {money(billedSubtotalMinor / 100, currency)}</p><p>GST on non-void bills: {money(gstTotalMinor / 100, currency)}</p>
                    <p>Based on bill creation dates in the selected range.</p>
                </section>}
                <section className="payment-report">
                    <h2>Outstanding bills</h2><p>{outstanding.length} open bills with a balance.</p><p>Total outstanding: {money(unpaidTotalMinor / 100, currency)}</p>
                    {isFull && outstanding.slice(0, 8).map(({ bill, dueMinor }) => <p key={bill.id}>Order {bill.orderId}: {money(dueMinor / 100, currency)} due</p>)}
                </section>
            </div>
            {canViewItemSales && <section className="item-sales-report">
                <div className="section-heading"><div><h2>Item lifecycle</h2><p>Values use KOT snapshot prices before discounts and GST. Legacy Closed KOTs count as ordered, not served.</p></div></div>
                <div className="report-cards item-sales-summary">
                    <article className="report-card"><h3>Ordered items / value</h3><h2>{totalItemQuantity} · {money(totalItemRevenueMinor / 100, currency)}</h2></article>
                    <article className="report-card"><h3>Served items / value</h3><h2>{totalServedQuantity} · {money(totalServedRevenue, currency)}</h2></article>
                    <article className="report-card"><h3>Cancelled items / value</h3><h2>{totalCancelledQuantity} · {money(totalCancelledRevenue, currency)}</h2></article>
                </div>
                <div className="reports-grid">
                    <section className="payment-report"><h2>Most ordered items</h2>
                        {bestSellingItems.length ? bestSellingItems.map(item => <p key={item.key}>{item.name} · {item.orderedQuantity} ordered · {money(item.revenue, currency)}</p>) : <p>No item sales in this date range.</p>}
                    </section>
                    <section className="payment-report"><h2>Least ordered items</h2>
                        {leastSellingItems.length ? leastSellingItems.map(item => <p key={item.key}>{item.name} · {item.orderedQuantity || 0} ordered · {money(item.revenue, currency)}</p>) : <p>No menu items found.</p>}
                    </section>
                    <section className="payment-report"><h2>Category-wise ordered value</h2>
                        {[...categorySales.values()].sort((a, b) => b.revenueMinor - a.revenueMinor).map(item => <p key={item.category}>{item.category} · {item.quantity} items · {money(item.revenueMinor / 100, currency)}</p>)}
                    </section>
                </div>
                <section className="report-table-section">
                    <h2>Item detail</h2>
                    {!allItemRows.length ? <p className="empty-state">No menu items or sales to report.</p> : <div className="responsive-table-wrap"><table>
                        <thead><tr><th>Menu item</th><th>Category</th><th>Ordered qty/value</th><th>Served qty/value</th><th>Cancelled qty/value</th><th>Orders</th></tr></thead>
                        <tbody>{allItemRows.sort((a, b) => (b.orderedQuantity || 0) - (a.orderedQuantity || 0) || a.name.localeCompare(b.name)).map(item => <tr key={item.key}><td>{item.name}</td><td>{item.category}</td><td>{item.orderedQuantity || 0} · {money(item.revenue, currency)}</td><td>{item.servedQuantity || 0} · {money(item.servedRevenue, currency)}</td><td>{item.cancelledQuantity || 0} · {money(item.cancelledRevenue, currency)}</td><td>{item.orderCount}</td></tr>)}</tbody>
                    </table></div>}
                </section>
                <p className="report-note">Ordered totals include the original KOT quantities. Served totals include active quantities from Served KOTs only. Cancelled totals include whole-KOT and item-level cancellations. Payment collections and tips are tracked separately above.</p>
            </section>}
            <section className="report-table-section">
                <h2>Orders in selected period</h2>
                {!reportOrders.length ? <p className="empty-state">No orders in this date range.</p> : <div className="responsive-table-wrap"><table>
                    <thead><tr><th>Order</th><th>Created</th><th>Type</th><th>Status</th><th>Payment</th></tr></thead>
                    <tbody>{reportOrders.map(order => <tr key={order.id}><td>#{order.orderNumber ?? order.id}</td><td>{order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}</td><td>{order.orderType || "—"}</td><td>{order.status}</td><td>{order.paymentStatus || "Unpaid"}</td></tr>)}</tbody>
                </table></div>}
            </section>
        </main>
    );
}

export default Reports;
