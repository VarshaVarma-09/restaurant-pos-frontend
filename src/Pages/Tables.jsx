import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";
import { useAuth } from "../Context/useAuth";

function Tables() {
    const { tables, orders, addRestaurantTable, updateRestaurantTable, setRestaurantTableStatus, toggleRestaurantTableActive } = useRestaurant();
    const { can } = useAuth();
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [form, setForm] = useState({ name: "", capacity: "2" });
    const [editingId, setEditingId] = useState(null);
    const [feedback, setFeedback] = useState("");
    const [feedbackType, setFeedbackType] = useState("success");
    const canManage = can("tables:manage");

    function showFeedback(message, type = "success") {
        setFeedback(message);
        setFeedbackType(type);
    }

    const filteredTables = useMemo(() => tables
        .filter(table => statusFilter === "All" || (statusFilter === "Inactive" ? table.active === false : table.status === statusFilter && table.active !== false))
        .filter(table => `${table.name ?? ""} ${table.id} ${table.status}`.toLowerCase().includes(search.trim().toLowerCase())),
    [tables, statusFilter, search]);

    function activeOrderForTable(table) {
        return orders.find(order => ["Open", "In Progress"].includes(order.status) && order.orderType === "DineIn" &&
            String(order.tableId ?? order.table) === String(table.id));
    }

    function submitTable(event) {
        event.preventDefault();
        if (!canManage) return;
        const name = form.name.trim();
        const capacity = Number(form.capacity);
        if (!name || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 50) {
            showFeedback("Enter a table name and a capacity between 1 and 50.", "error");
            return;
        }
        try {
            if (editingId !== null) {
                updateRestaurantTable(editingId, { name, capacity });
                showFeedback("Table updated.");
            } else {
                addRestaurantTable({ name, capacity });
                showFeedback("Table added.");
            }
        } catch (error) {
            showFeedback(error?.message || "Unable to save this table.", "error");
            return;
        }
        setForm({ name: "", capacity: "2" });
        setEditingId(null);
    }

    function setTableStatus(table, status) {
        if (!canManage) return;
        if (activeOrderForTable(table)) {
            showFeedback("This table has an open dine-in order. Complete or cancel the order to release it.", "error");
            return;
        }
        try {
            setRestaurantTableStatus(table.id, status);
            showFeedback(`Table ${table.name ?? table.id} is now ${status.toLowerCase()}.`);
        } catch (error) {
            showFeedback(error?.message || "Unable to update this table status.", "error");
        }
    }

    function toggleActive(table) {
        if (!canManage) return;
        if (table.active !== false && activeOrderForTable(table)) {
            showFeedback("A table with an active dine-in order cannot be deactivated.", "error");
            return;
        }
        try {
            toggleRestaurantTableActive(table.id);
            showFeedback(table.active === false ? "Table reactivated." : "Table deactivated.");
        } catch (error) {
            showFeedback(error?.message || "Unable to update this table.", "error");
        }
    }

    function editTable(table) {
        if (!canManage) return;
        setEditingId(table.id);
        setForm({ name: table.name ?? `Table ${table.id}`, capacity: String(table.capacity ?? 2) });
    }

    return (
        <main className="page">
            <h1>Tables</h1>
            <p>View table availability and the dine-in order using each table.</p>
            {feedback && <p className={feedbackType === "error" ? "form-error" : "form-success"}
                role={feedbackType === "error" ? "alert" : "status"}>{feedback}</p>}
            {canManage && <form className="table-form" onSubmit={submitTable}>
                <h2>{editingId === null ? "Add a table" : "Edit table"}</h2>
                <label htmlFor="table-name">Table name</label>
                <input id="table-name" value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} placeholder="e.g. Patio 1" required />
                <label htmlFor="table-capacity">Capacity</label>
                <input id="table-capacity" type="number" min="1" max="50" value={form.capacity} onChange={event => setForm(previous => ({ ...previous, capacity: event.target.value }))} required />
                <button type="submit">{editingId === null ? "Add table" : "Save table"}</button>
                {editingId !== null && <button type="button" onClick={() => { setEditingId(null); setForm({ name: "", capacity: "2" }); }}>Cancel edit</button>}
            </form>}
            <div className="page-toolbar">
                <label>Search tables<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Table name or number" /></label>
                <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                    {["All", "Available", "Occupied", "Reserved", ...(canManage ? ["Inactive"] : [])].map(status => <option key={status}>{status}</option>)}
                </select></label>
            </div>
            <div className="tables-grid">
                {filteredTables.length === 0 ? <p className="empty-state">No tables match this view.</p> : filteredTables.map(table => {
                    const activeOrder = activeOrderForTable(table);
                    const isActive = table.active !== false;
                    return <article className={`table-card ${!isActive ? "table-card-inactive" : ""}`} key={table.id}>
                        <div className="table-card-heading"><h2>{table.name || `Table ${table.id}`}</h2><span className={`table-status ${isActive ? table.status.toLowerCase() : "inactive"}`}>{isActive ? table.status : "Inactive"}</span></div>
                        <p><strong>Capacity:</strong> {table.capacity ?? "Not set"}</p>
                        {activeOrder ? <p><strong>Active order:</strong> #{activeOrder.orderNumber ?? activeOrder.id}</p> : <p>No active dine-in order.</p>}
                        {activeOrder && <Link className="text-link" to={`/orders?orderId=${encodeURIComponent(activeOrder.id)}`}>View order</Link>}
                        {isActive && table.status === "Available" && !activeOrder && <Link className="button-link" to={`/orders/new?table=${encodeURIComponent(table.id)}`}>New order</Link>}
                        {canManage && <div className="table-actions">
                            <button type="button" onClick={() => editTable(table)} disabled={!isActive}>Edit</button>
                            {isActive && !activeOrder && <select aria-label={`Set status for ${table.name ?? table.id}`} value={table.status} onChange={event => setTableStatus(table, event.target.value)}>
                                {["Available", "Reserved", "Occupied"].map(status => <option key={status}>{status}</option>)}
                            </select>}
                            <button type="button" className="danger-button" onClick={() => toggleActive(table)}>{isActive ? "Deactivate" : "Reactivate"}</button>
                        </div>}
                    </article>;
                })}
            </div>
        </main>
    );
}

export default Tables;
