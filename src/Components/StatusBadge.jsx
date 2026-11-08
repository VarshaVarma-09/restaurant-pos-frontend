function getStatusKind(status) {
    const normalized = String(status || "unknown").toLowerCase().replace(/\s+/g, "-");
    if (["completed", "served", "settled", "paid", "available"].includes(normalized)) return "success";
    if (["cancelled", "void", "failed", "inactive"].includes(normalized)) return "danger";
    if (["in-progress", "preparing", "ready", "occupied"].includes(normalized)) return "active";
    if (["open", "queued", "unpaid", "partially-paid", "reserved", "pending"].includes(normalized)) return "pending";
    return "neutral";
}

function StatusBadge({ status, label }) {
    return <span className={`status-badge status-badge-${getStatusKind(status)}`}>{label || status || "Unknown"}</span>;
}

export default StatusBadge;
