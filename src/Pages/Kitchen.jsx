import { useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";
import { useAuth } from "../Context/useAuth";

const KOT_SECTIONS = [
    { id: "active", title: "Active Kitchen Queue", statuses: ["Queued", "Preparing"] },
    { id: "history", title: "KOT History · Ready, Served, Cancelled, Legacy Closed", statuses: ["Ready", "Served", "Cancelled", "Closed"] },
    { id: "resolved", title: "Unfinished KOTs on Closed Orders", statuses: ["Queued", "Preparing"] }
];

function formatDateTime(value) {
    if (!value) return "Time unavailable";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

function getSequence(kot, index) {
    return kot.sequence ?? kot.kotNumber ?? index + 1;
}

function Kitchen() {
    const { kots, orders, updateKotStatus } = useRestaurant();
    const { can } = useAuth();
    const [feedback, setFeedback] = useState(null);
    const [busyKotId, setBusyKotId] = useState(null);
    const [cancellingKotId, setCancellingKotId] = useState(null);
    const [cancellationReasons, setCancellationReasons] = useState({});

    async function changeStatus(kot, nextStatus, cancellationReason = "") {
        if (busyKotId) return;
        setFeedback(null);

        const order = orders.find(item => item.id === kot.orderId);
        if (!order || !["Open", "In Progress"].includes(order.status)) {
            setFeedback({ type: "error", message: "This KOT cannot be changed because its order is closed or unavailable." });
            return;
        }

        if (nextStatus === "Cancelled") {
            if (!cancellationReason.trim()) {
                setFeedback({ type: "error", message: "A cancellation reason is required." });
                return;
            }
        }

        setBusyKotId(kot.id);
        try {
            await updateKotStatus(kot.id, nextStatus, cancellationReason);
            setCancellingKotId(null);
            setCancellationReasons(previous => ({ ...previous, [kot.id]: "" }));
            setFeedback({
                type: "success",
                message: nextStatus === "Cancelled"
                    ? "KOT cancelled and the reason was recorded."
                    : `KOT moved to ${nextStatus}.`
            });
        } catch (error) {
            setFeedback({ type: "error", message: error?.message || "Unable to update this KOT." });
        } finally {
            setBusyKotId(null);
        }
    }

    const orderedKots = [...kots].sort((first, second) => {
        const firstOrder = orders.find(order => order.id === first.orderId);
        const secondOrder = orders.find(order => order.id === second.orderId);
        const firstTime = new Date(first.createdAt || 0).getTime();
        const secondTime = new Date(second.createdAt || 0).getTime();
        return firstTime - secondTime || String(firstOrder?.orderNumber ?? first.orderId)
            .localeCompare(String(secondOrder?.orderNumber ?? second.orderId));
    });

    return (
        <main className="page kitchen-page">
            <header className="kitchen-header">
                <div>
                    <h1>Kitchen Orders</h1>
                    <p>Track incoming tickets and update kitchen progress.</p>
                </div>
                <span className="kitchen-total">{kots.length} {kots.length === 1 ? "ticket" : "tickets"}</span>
            </header>

            {feedback && (
                <p className={feedback.type === "error" ? "form-error" : "form-success"}
                    role={feedback.type === "error" ? "alert" : "status"} aria-live="polite">
                    {feedback.message}
                </p>
            )}

            <div className="kitchen-dashboard-sections">
                {KOT_SECTIONS.map(section => (
                    <section className="kitchen-section" key={section.id} aria-labelledby={`kitchen-section-${section.id}`}>
                        <h2 id={`kitchen-section-${section.id}`}>{section.title}</h2>
                        <div className="kitchen-columns">
                            {section.statuses.map(status => {
                                const statusKots = orderedKots.filter(kot => {
                                    if (kot.status !== status) return false;
                                    const kotOrder = orders.find(item => item.id === kot.orderId);
                                    const orderIsActive = ["Open", "In Progress"].includes(kotOrder?.status);
                                    if (section.id === "active") return orderIsActive;
                                    if (section.id === "resolved") return !orderIsActive && ["Queued", "Preparing"].includes(kot.status);
                                    return true;
                                });
                                return (
                                    <section className="kitchen-column" key={status} aria-labelledby={`kitchen-${status}`}>
                            <div className="kitchen-column-heading">
                                <h2 id={`kitchen-${status}`}>{status}</h2>
                                <span>{statusKots.length}</span>
                            </div>
                            {statusKots.length === 0 ? (
                                <p className="kitchen-empty">No {status.toLowerCase()} tickets.</p>
                            ) : statusKots.map((kot, index) => {
                                const order = orders.find(item => item.id === kot.orderId);
                                const isEditable = ["Open", "In Progress"].includes(order?.status) && !["Cancelled", "Closed", "Served"].includes(status);
                                const sequence = getSequence(kot, index);
                                return (
                                    <article className="kitchen-ticket" key={kot.id}>
                                        <div className="kitchen-ticket-title">
                                            <h3>KOT #{sequence}</h3>
                                            <span className={`kitchen-status kitchen-status-${status.toLowerCase()}`}>{status}</span>
                                        </div>
                                        <dl className="kitchen-meta">
                                            <div><dt>Order</dt><dd>#{order?.orderNumber ?? kot.orderId}</dd></div>
                                            <div><dt>Type</dt><dd>{order?.orderType === "DineIn" ? "Dine-in" : order?.orderType || "Unknown"}</dd></div>
                                            {order?.orderType === "DineIn" && (
                                                <div><dt>Table</dt><dd>{order.tableId ?? order.table ?? "Unassigned"}</dd></div>
                                            )}
                                            <div><dt>Created</dt><dd>{formatDateTime(kot.createdAt)}</dd></div>
                                            <div><dt>Order created</dt><dd>{formatDateTime(order?.createdAt)}</dd></div>
                                        </dl>
                                        <div className="kitchen-items">
                                            <h4>Items</h4>
                                            {Array.isArray(kot.items) && kot.items.length > 0 ? kot.items.map((item, itemIndex) => (
                                                <div className="kitchen-item" key={`${item.menuItemId ?? item.name ?? "item"}-${itemIndex}`}>
                                                    <div><strong>{item.name || "Unnamed item"}</strong><span>× {Math.max(0, Number(item.quantity || 0) - Number(item.cancelledQuantity || 0))}</span></div>
                                                    {Number(item.cancelledQuantity || 0) > 0 && <p>{item.cancelledQuantity} of {item.quantity} cancelled</p>}
                                                    {item.notes && <p>Note: {item.notes}</p>}
                                                </div>
                                            )) : <p>No items recorded on this ticket.</p>}
                                        </div>
                                        {kot.status === "Cancelled" && kot.cancellationReason && (
                                            <p className="kitchen-cancel-reason"><strong>Cancellation reason:</strong> {kot.cancellationReason}</p>
                                        )}
                                        {kot.status === "Served" && (
                                            <p className="kitchen-locked"><strong>Served:</strong> {formatDateTime(kot.servedAt)}{kot.servedBy?.name ? ` · ${kot.servedBy.name}` : ""}</p>
                                        )}
                                        {kot.status === "Closed" && (
                                            <>
                                                {(kot.closureReason || kot.cancellationReason) && <p className="kitchen-cancel-reason"><strong>Legacy closure:</strong> {kot.closureReason || kot.cancellationReason}</p>}
                                                <p className="kitchen-locked"><strong>Closed:</strong> {formatDateTime(kot.closedAt ?? kot.updatedAt)}</p>
                                            </>
                                        )}
                                        {kot.legacyWorkflowReview && <p className="form-error"><strong>Legacy review required:</strong> {kot.legacyWorkflowReview}</p>}
                                        {kot.status === "Cancelled" && (
                                            <p className="kitchen-locked"><strong>Finalized:</strong> {formatDateTime(kot.cancelledAt ?? kot.updatedAt)}</p>
                                        )}
                                        {order?.completionType === "Override" && (
                                            <p className="kitchen-locked"><strong>Order override:</strong> {order.completionReason || "Reason unavailable"}</p>
                                        )}
                                        {order?.status === "Cancelled" && order.cancellationReason && (
                                            <p className="kitchen-cancel-reason"><strong>Order cancellation:</strong> {order.cancellationReason}</p>
                                        )}
                                        {isEditable && can("kitchen:update") && (
                                            <div className="kitchen-actions">
                                                {status === "Queued" && (
                                                    <button type="button" disabled={busyKotId !== null} onClick={() => changeStatus(kot, "Preparing")}>
                                                        {busyKotId === kot.id ? "Updating…" : "Start preparing"}
                                                    </button>
                                                )}
                                                {status === "Preparing" && (
                                                    <button type="button" disabled={busyKotId !== null} onClick={() => changeStatus(kot, "Ready")}>
                                                        {busyKotId === kot.id ? "Updating…" : "Mark ready"}
                                                    </button>
                                                )}
                                                {can("kitchen:cancel") && cancellingKotId === kot.id ? (
                                                    <form className="kitchen-cancel-form" onSubmit={event => {
                                                        event.preventDefault();
                                                        changeStatus(kot, "Cancelled", cancellationReasons[kot.id] || "");
                                                    }}>
                                                        <label htmlFor={`cancel-reason-${kot.id}`}>Cancellation reason</label>
                                                        <input id={`cancel-reason-${kot.id}`} value={cancellationReasons[kot.id] || ""}
                                                            onChange={event => setCancellationReasons(previous => ({ ...previous, [kot.id]: event.target.value }))}
                                                            maxLength={240} required disabled={busyKotId !== null} />
                                                        <button className="kitchen-cancel" type="submit" disabled={busyKotId !== null}>Confirm cancellation</button>
                                                        <button type="button" disabled={busyKotId !== null} onClick={() => setCancellingKotId(null)}>Keep KOT</button>
                                                    </form>
                                                ) : can("kitchen:cancel") && (
                                                    <button className="kitchen-cancel" type="button" disabled={busyKotId !== null}
                                                        onClick={() => { setFeedback(null); setCancellingKotId(kot.id); }}>
                                                        Cancel KOT
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        {!isEditable && order && !["Open", "In Progress"].includes(order.status) && (
                                            <p className="kitchen-locked">Order {order.status.toLowerCase()}; ticket is read-only.</p>
                                        )}
                                    </article>
                                );
                            })}
                                    </section>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </main>
    );
}

export default Kitchen;
