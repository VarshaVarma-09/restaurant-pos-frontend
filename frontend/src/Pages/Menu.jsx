import { useMemo, useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";
import { useAuth } from "../Context/useAuth";

const EMPTY_FORM = { name: "", description: "", category: "", price: "" };

function Menu() {
    const { menuItems, saveMenuItem, toggleMenuItemAvailability, restaurantSettings } = useRestaurant();
    const { can } = useAuth();
    const canManage = can("menu:manage");
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("All");
    const [availability, setAvailability] = useState("All");
    const [feedback, setFeedback] = useState(null);

    const categories = useMemo(() => [...new Set(menuItems.map(item => item.category).filter(Boolean))].sort(), [menuItems]);
    const filteredItems = menuItems.filter(item =>
        `${item.name} ${item.description || ""} ${item.category || ""}`.toLowerCase().includes(search.trim().toLowerCase()) &&
        (category === "All" || item.category === category) &&
        (availability === "All" || (availability === "Available" ? item.available !== false : item.available === false))
    );

    async function submitItem(event) {
        event.preventDefault();
        if (!canManage) return;
        const name = form.name.trim();
        const price = Number(form.price);
        if (!name || !Number.isFinite(price) || price <= 0) {
            setFeedback({ type: "error", message: "Enter an item name and a price greater than zero." });
            return;
        }
        try {
            await saveMenuItem(editingId, { name, description: form.description, category: form.category, price });
            setFeedback({ type: "success", message: editingId !== null
                ? "Menu item updated. Existing order snapshots retain their original names and prices."
                : "Menu item added." });
        } catch (error) {
            setFeedback({ type: "error", message: error?.message || "Unable to save this menu item." });
            return;
        }
        setForm(EMPTY_FORM);
        setEditingId(null);
    }

    function editItem(item) {
        if (!canManage) return;
        setEditingId(item.id);
        setForm({ name: item.name, description: item.description || "", category: item.category || "", price: String(item.price) });
    }

    async function toggleAvailability(item) {
        if (!canManage) return;
        try {
            await toggleMenuItemAvailability(item.id);
            setFeedback({ type: "success", message: item.available === false ? "Menu item reactivated." : "Menu item deactivated; existing snapshots are unchanged." });
        } catch (error) {
            setFeedback({ type: "error", message: error?.message || "Unable to update menu item availability." });
        }
    }

    return (
        <main className="page">
            <h1>Menu</h1>
            <p>Browse available items. Managers and owners can update the catalog.</p>
            {feedback && <p className={feedback.type === "error" ? "form-error" : "form-success"}
                role={feedback.type === "error" ? "alert" : "status"}>{feedback.message}</p>}
            {canManage && <form className="menu-form" onSubmit={submitItem}>
                <h2>{editingId === null ? "Add menu item" : "Edit menu item"}</h2>
                <label htmlFor="menu-name">Name</label><input id="menu-name" value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} required />
                <label htmlFor="menu-description">Description</label><textarea id="menu-description" value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} />
                <label htmlFor="menu-category">Category</label><input id="menu-category" value={form.category} onChange={event => setForm(previous => ({ ...previous, category: event.target.value }))} placeholder="e.g. Mains" list="menu-categories" />
                <datalist id="menu-categories">{categories.map(item => <option key={item} value={item} />)}</datalist>
                <label htmlFor="menu-price">Price</label><input id="menu-price" type="number" min="0.01" step="0.01" value={form.price} onChange={event => setForm(previous => ({ ...previous, price: event.target.value }))} required />
                <button type="submit">{editingId === null ? "Add item" : "Save item"}</button>
                {editingId !== null && <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>Cancel edit</button>}
            </form>}
            <div className="page-toolbar">
                <label>Search menu<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or description" /></label>
                <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option>All</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
                <label>Availability<select value={availability} onChange={event => setAvailability(event.target.value)}><option>All</option><option>Available</option><option>Unavailable</option></select></label>
            </div>
            <div className="menu-list">
                {filteredItems.length === 0 ? <p className="empty-state">No menu items match this view.</p> : filteredItems.map(item => <article className={`menu-card ${item.available === false ? "menu-card-unavailable" : ""}`} key={item.id}>
                    <div className="menu-card-heading"><h2>{item.name}</h2><span className={`availability-badge ${item.available === false ? "unavailable" : "available"}`}>{item.available === false ? "Unavailable" : "Available"}</span></div>
                    {item.category && <p className="menu-category">{item.category}</p>}
                    {item.description && <p>{item.description}</p>}
                    <p className="menu-price">{new Intl.NumberFormat("en-IN", { style: "currency", currency: restaurantSettings.currency || "INR" }).format(Number(item.price) || 0)}</p>
                    {canManage && <div className="menu-actions"><button type="button" onClick={() => editItem(item)}>Edit</button><button type="button" className="danger-button" onClick={() => toggleAvailability(item)}>{item.available === false ? "Reactivate" : "Deactivate"}</button></div>}
                </article>)}
            </div>
        </main>
    );
}

export default Menu;
