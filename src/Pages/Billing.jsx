import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";
import {
    getCompletedPaymentTotal,
    getPaymentAppliedAmount,
    getPaymentChangeAmount,
    getPaymentTipAmount,
    getPaymentTotalMinor
} from "../utils/payments";
import { useAuth } from "../Context/useAuth";

function money(amount, currency = "INR") {
    const value = Number(amount);
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number.isFinite(value) ? value : 0);
}

function dateTime(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Time unavailable";
}

function Billing() {
    const { orders, kots, bills, payments, setBillDiscount, recordPayment, updateBillStatus, settleZeroBalanceBill, restaurantSettings } = useRestaurant();
    const { can } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [discountDrafts, setDiscountDrafts] = useState({});
    const [paymentDrafts, setPaymentDrafts] = useState({});
    const [feedback, setFeedback] = useState({});
    const paymentSubmissionLocks = useRef(new Set());
    const paymentRequestKeys = useRef(new Map());
    const [submittingPayments, setSubmittingPayments] = useState({});
    const currency = restaurantSettings.currency || "INR";
    const focusedOrderId = searchParams.get("orderId");

    const visibleBills = useMemo(() => bills
        .filter(bill => !focusedOrderId || String(bill.orderId) === String(focusedOrderId))
        .filter(bill => statusFilter === "All" || bill.status === statusFilter)
        .filter(bill => {
            const order = orders.find(item => item.id === bill.orderId);
            const haystack = [bill.id, order?.orderNumber, order?.customerName, order?.customerPhone, order?.tableId]
                .filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(search.trim().toLowerCase());
        })
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [bills, orders, search, statusFilter, focusedOrderId]);

    function getPaymentTotal(bill) {
        return getCompletedPaymentTotal(payments, bill.orderId, bill.id);
    }

    function getBillItems(bill) {
        const orderKots = kots.filter(kot => kot.orderId === bill.orderId);
        const ticketItems = orderKots.filter(kot => kot.status !== "Cancelled")
            .flatMap(kot => (kot.items || []).map(item => ({
                ...item,
                quantity: Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0))
            })).filter(item => item.quantity > 0));
        return orderKots.length ? ticketItems : (bill.items || []);
    }

    function setBillFeedback(id, type, message) {
        setFeedback(previous => ({ ...previous, [id]: { type, message } }));
    }

    async function applyDiscount(bill) {
        try {
            await setBillDiscount(bill.orderId, discountDrafts[bill.id] ?? bill.discount ?? 0);
            setBillFeedback(bill.id, "success", "Discount updated.");
        } catch (error) {
            setBillFeedback(bill.id, "error", error.message || "Unable to update discount.");
        }
    }

    async function submitPayment(event, bill) {
        event.preventDefault();
        if (paymentSubmissionLocks.current.has(bill.id)) return;
        paymentSubmissionLocks.current.add(bill.id);
        setSubmittingPayments(previous => ({ ...previous, [bill.id]: true }));
        const draft = paymentDrafts[bill.id] || {};
        const due = Math.max(0, Number(bill.grandTotal || 0) - getPaymentTotal(bill));
        const amountApplied = draft.mode === "Partial" ? draft.amountApplied : due;
        const tipAmount = draft.tipAmount || 0;
        try {
            // Yield so React can render the disabled state before the synchronous local transaction runs.
            await new Promise(resolve => window.setTimeout(resolve, 0));
            const idempotencyKey = paymentRequestKeys.current.get(bill.id) || globalThis.crypto?.randomUUID?.() || `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            paymentRequestKeys.current.set(bill.id, idempotencyKey);
            const payment = await recordPayment(bill.orderId, {
                amountApplied,
                tipAmount,
                idempotencyKey,
                mode: draft.mode || "Full",
                method: draft.method,
                status: draft.status || "Completed",
                ...(draft.method === "Cash" && draft.cashTendered !== "" && draft.cashTendered !== undefined
                    ? { cashTendered: draft.cashTendered }
                    : {})
            });
            paymentRequestKeys.current.delete(bill.id);
            setBillFeedback(bill.id, "success", `${payment.status} payment recorded: ${money(payment.amountApplied, currency)} applied to bill and ${money(payment.tipAmount, currency)} tip.`);
            setPaymentDrafts(previous => ({
                ...previous,
                [bill.id]: {
                    ...previous[bill.id],
                    amountApplied: "",
                    tipAmount: "",
                    cashTendered: ""
                }
            }));
        } catch (error) {
            setBillFeedback(bill.id, "error", error.message || "Unable to record payment.");
        } finally {
            paymentSubmissionLocks.current.delete(bill.id);
            setSubmittingPayments(previous => ({ ...previous, [bill.id]: false }));
        }
    }

    async function voidBill(bill) {
        if (!window.confirm("Void this cancelled order's bill? This cannot be reversed.")) return;
        try {
            await updateBillStatus(bill.id, "Void");
            setBillFeedback(bill.id, "success", "Bill voided.");
        } catch (error) {
            setBillFeedback(bill.id, "error", error.message || "Unable to void bill.");
        }
    }

    async function settleZeroBalance(bill) {
        try {
            await settleZeroBalanceBill(bill.id);
            setBillFeedback(bill.id, "success", "Zero-balance bill settled. No payment transaction was recorded.");
        } catch (error) {
            setBillFeedback(bill.id, "error", error.message || "Unable to settle this zero-balance bill.");
        }
    }

    return (
        <main className="page">
            <h1>Billing</h1>
            <p>Review consolidated bills, apply discounts, and record payment transactions.</p>
            {focusedOrderId && <div className="billing-focus"><strong>Showing bill for order {focusedOrderId}.</strong> <button type="button" onClick={() => setSearchParams({})}>Show all bills</button></div>}

            <div className="page-toolbar">
                <label>Search bills<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Order, customer, phone, table" /></label>
                <label>Bill status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                    {["All", "Open", "Settled", "Void"].map(status => <option key={status}>{status}</option>)}
                </select></label>
            </div>

            <div className="billing-list">
                {visibleBills.length === 0 ? <p className="empty-state">No bills match this view.</p> : visibleBills.map(bill => {
                    const order = orders.find(item => item.id === bill.orderId);
                    const billItems = getBillItems(bill);
                    const paid = getPaymentTotal(bill);
                    const due = Math.max(0, Number(bill.grandTotal || 0) - paid);
                    const paymentStatus = paid <= 0 ? "Unpaid" : due <= 0.005 ? "Paid" : "Partially Paid";
                    const billPayments = payments.filter(payment => {
                        const hasBillId = Object.prototype.hasOwnProperty.call(payment, "billId");
                        return hasBillId ? payment.billId === bill.id : payment.orderId === bill.orderId;
                    });
                    const canManage = can("billing:manage");
                    const draft = paymentDrafts[bill.id] || {};
                    const mode = draft.mode || "Full";
                    const appliedPreview = mode === "Full" ? due : Number(draft.amountApplied || 0);
                    const tipPreview = Number(draft.tipAmount || 0);
                    const customerTotalPreview = appliedPreview + tipPreview;
                    const tenderedPreview = draft.cashTendered === undefined || draft.cashTendered === ""
                        ? customerTotalPreview
                        : Number(draft.cashTendered);
                    const cashChangePreview = Math.max(0, Number.isFinite(tenderedPreview)
                        ? tenderedPreview - customerTotalPreview
                        : 0);
                    const balanceAfterPreview = (draft.status || "Completed") === "Completed"
                        ? Math.max(0, due - appliedPreview)
                        : due;
                    const setPaymentDraftField = (field, value) => setPaymentDrafts(previous => ({
                        ...previous,
                        [bill.id]: { ...previous[bill.id], [field]: value }
                    }));
                    return (
                        <article className="bill-card" key={bill.id}>
                            <div className="bill-heading">
                                <div><h2>Order #{order?.orderNumber ?? bill.orderId}</h2><p>Bill {bill.id}</p></div>
                                <span className={`bill-status bill-status-${String(bill.status).toLowerCase()}`}>{bill.status}</span>
                            </div>
                            <div className="bill-customer-grid">
                                <p><strong>Customer</strong>{order?.customerName || "Not provided"}</p>
                                <p><strong>Phone</strong>{order?.customerPhone || "Not provided"}</p>
                                <p><strong>Order</strong>{order?.orderType || "Unknown"}{order?.orderType === "DineIn" ? ` · Table ${order.tableId ?? order.table ?? "—"}` : ""}</p>
                                <p><strong>Order status</strong>{order?.status || "Unknown"}</p>
                            </div>
                            <h3>Bill items</h3>
                            {billItems.length ? <div className="bill-items">
                                {billItems.map((item, index) => <div className="bill-item-row" key={`${item.menuItemId ?? item.name}-${index}`}>
                                    <span>{item.name} × {item.quantity}</span><span>{money(Number(item.unitPrice ?? item.price) * Number(item.quantity), currency)}</span>
                                </div>)}
                            </div> : <p>No billable items.</p>}
                            <div className="bill-totals">
                                <p><span>Subtotal</span><strong>{money(bill.subtotal, currency)}</strong></p>
                                <p><span>Discount</span><strong>− {money(bill.discount, currency)}</strong></p>
                                <p><span>GST ({(Number(bill.taxRate ?? 0.18) * 100).toFixed(2)}%)</span><strong>{money(bill.taxAmount, currency)}</strong></p>
                                <p className="bill-grand-total"><span>Grand total</span><strong>{money(bill.grandTotal, currency)}</strong></p>
                                <p><span>Payment status</span><strong>{paymentStatus}</strong></p>
                                <p><span>Amount received</span><strong>{money(paid, currency)}</strong></p>
                                <p className="bill-due"><span>Outstanding</span><strong>{money(due, currency)}</strong></p>
                            </div>

                            {bill.status === "Open" && canManage && <>
                                <form className="bill-inline-form" onSubmit={event => { event.preventDefault(); applyDiscount(bill); }}>
                                    <label htmlFor={`discount-${bill.id}`}>Discount amount</label>
                                    <input id={`discount-${bill.id}`} type="number" min="0" max={bill.subtotal} step="0.01"
                                        value={discountDrafts[bill.id] ?? bill.discount ?? 0}
                                        onChange={event => setDiscountDrafts(previous => ({ ...previous, [bill.id]: event.target.value }))} />
                                    <button type="submit">Apply discount</button>
                                </form>
                                <form className="bill-inline-form payment-form" aria-busy={Boolean(submittingPayments[bill.id])}
                                    onSubmit={event => submitPayment(event, bill)}>
                                    <h3>Record payment</h3>
                                    <fieldset className="payment-mode">
                                        <legend>Payment mode</legend>
                                        <label><input type="radio" name={`payment-mode-${bill.id}`} value="Full" checked={mode === "Full"}
                                            onChange={() => setPaymentDraftField("mode", "Full")} /> Pay full balance</label>
                                        <label><input type="radio" name={`payment-mode-${bill.id}`} value="Partial" checked={mode === "Partial"}
                                            onChange={() => setPaymentDraftField("mode", "Partial")} /> Partial payment</label>
                                    </fieldset>
                                    {mode === "Full" ? (
                                        <p className="payment-applied-preview"><strong>Amount applied to bill:</strong> {money(due, currency)}</p>
                                    ) : <>
                                        <label htmlFor={`amount-${bill.id}`}>Amount applied to bill</label>
                                        <input id={`amount-${bill.id}`} type="number" min="0.01" max={due} step="0.01" required
                                            value={draft.amountApplied ?? ""}
                                            onChange={event => setPaymentDraftField("amountApplied", event.target.value)} />
                                    </>}
                                    <label htmlFor={`tip-${bill.id}`}>Optional tip</label>
                                    <input id={`tip-${bill.id}`} type="number" min="0" step="0.01" value={draft.tipAmount ?? ""}
                                        onChange={event => setPaymentDraftField("tipAmount", event.target.value)} />
                                    <label htmlFor={`method-${bill.id}`}>Method</label>
                                    <select id={`method-${bill.id}`} required value={draft.method || ""}
                                        onChange={event => setPaymentDraftField("method", event.target.value)}>
                                        <option value="">Select method</option><option>Cash</option><option>UPI</option><option>Card</option>
                                    </select>
                                    <label htmlFor={`payment-status-${bill.id}`}>Transaction status</label>
                                    <select id={`payment-status-${bill.id}`} value={draft.status || "Completed"}
                                        onChange={event => setPaymentDraftField("status", event.target.value)}>
                                        <option>Completed</option><option>Pending</option><option>Failed</option>
                                    </select>
                                    {draft.method === "Cash" ? <>
                                        <label htmlFor={`cash-tendered-${bill.id}`}>Cash tendered (optional)</label>
                                        <input id={`cash-tendered-${bill.id}`} type="number" min="0" step="0.01" value={draft.cashTendered ?? ""}
                                            onChange={event => setPaymentDraftField("cashTendered", event.target.value)} />
                                        <p className="payment-calculation"><strong>Change returned:</strong> {money(cashChangePreview, currency)}{Number.isFinite(tenderedPreview) && tenderedPreview < customerTotalPreview ? ` · ${money(customerTotalPreview - tenderedPreview, currency)} short` : ""}</p>
                                    </> : draft.method && <p className="payment-calculation"><strong>Total to charge:</strong> {money(customerTotalPreview, currency)}</p>}
                                    <p className="payment-calculation"><strong>Outstanding after this transaction:</strong> {money(balanceAfterPreview, currency)}</p>
                                    <p className="payment-tip-note">Tips are recorded separately and do not change the bill balance or GST. The submission lock prevents duplicate clicks in this tab; backend idempotency is still required for real payment processing.</p>
                                    <button type="submit" disabled={due <= 0 || submittingPayments[bill.id]}>
                                        {submittingPayments[bill.id] ? "Recording…" : "Record transaction"}
                                    </button>
                                </form>
                            </>}

                            {order?.status === "Cancelled" && bill.status === "Open" && canManage && <button className="danger-button" type="button" onClick={() => voidBill(bill)}>Void cancelled order bill</button>}
                            {bill.status === "Open" && Number(bill.grandTotal) === 0 && canManage && <button type="button" onClick={() => settleZeroBalance(bill)}>Settle zero-balance bill</button>}
                            {feedback[bill.id] && <p className={feedback[bill.id].type === "error" ? "form-error" : "form-success"} role={feedback[bill.id].type === "error" ? "alert" : "status"}>{feedback[bill.id].message}</p>}
                            <details className="payment-history">
                                <summary>Transaction history ({billPayments.length})</summary>
                                {billPayments.length ? billPayments.map(payment => <div className="payment-row" key={payment.id}>
                                    <span>{payment.method} · {payment.status}</span>
                                    <strong>Bill: {money(getPaymentAppliedAmount(payment), currency)}</strong>
                                    <span>Tip: {money(getPaymentTipAmount(payment), currency)}</span>
                                    {payment.method === "Cash" && payment.cashTendered != null && <span>Tendered: {money(payment.cashTendered, currency)} · Change: {money(getPaymentChangeAmount(payment), currency)}</span>}
                                    {payment.method !== "Cash" && getPaymentTotalMinor(payment) > 0 && <span>Charged: {money(getPaymentTotalMinor(payment) / 100, currency)}</span>}
                                    <time>{dateTime(payment.timestamp ?? payment.createdAt)}</time>
                                </div>) : <p>No payment transactions recorded.</p>}
                            </details>
                            {order && <Link className="text-link" to={`/orders?orderId=${encodeURIComponent(order.id)}`}>View order</Link>}
                        </article>
                    );
                })}
            </div>
        </main>
    );
}

export default Billing;
