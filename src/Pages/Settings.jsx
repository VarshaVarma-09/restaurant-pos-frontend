import { useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";
import { useAuth } from "../Context/useAuth";

function Settings() {
    const { restaurantSettings, updateRestaurantSettings, waiters, addWaiterAccount, updateWaiterAccountStatus } = useRestaurant();
    const { can } = useAuth();
    const isOwner = can("settings:full");
    const [form, setForm] = useState(restaurantSettings);
    const [feedback, setFeedback] = useState(null);
    const [waiterUsername, setWaiterUsername] = useState("");
    const [waiterName, setWaiterName] = useState("");
    const [waiterFeedback, setWaiterFeedback] = useState(null);

    function saveSettings(event) {
        event.preventDefault();
        const name = String(form.name || "").trim();
        const ratePercent = Number(form.gstRate ?? 0.18) * 100;
        if (!name) {
            setFeedback({ type: "error", message: "Restaurant name is required." });
            return;
        }
        if (isOwner && (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100)) {
            setFeedback({ type: "error", message: "GST rate must be between 0 and 100 percent." });
            return;
        }
        try {
            const result = updateRestaurantSettings({
                ...form,
                name,
                ...(isOwner ? { gstRate: ratePercent / 100 } : {})
            });
            if (result?.ok === false) throw new Error(result.error || "Settings could not be persisted.");
            setFeedback({ type: "success", message: "Restaurant settings saved. GST and currency changes apply to new bills." });
        } catch (error) {
            setFeedback({ type: "error", message: error.message || "Unable to save settings." });
        }
    }

    function change(key, value) {
        setForm(previous => ({ ...previous, [key]: value }));
    }

    function saveWaiter(event) {
        event.preventDefault();
        try {
            addWaiterAccount({ username: waiterUsername, name: waiterName });
            setWaiterUsername("");
            setWaiterName("");
            setWaiterFeedback({ type: "success", message: "Waiter account added and activated." });
        } catch (error) {
            setWaiterFeedback({ type: "error", message: error.message || "Unable to add the Waiter account." });
        }
    }

    function toggleWaiter(waiter) {
        try {
            updateWaiterAccountStatus(waiter.id, waiter.active === false);
            setWaiterFeedback({ type: "success", message: `${waiter.name} is now ${waiter.active === false ? "active" : "inactive"}.` });
        } catch (error) {
            setWaiterFeedback({ type: "error", message: error.message || "Unable to update the Waiter account." });
        }
    }

    return (
        <main className="page">
            <h1>Settings</h1>
            <p>Manage restaurant details and billing defaults.</p>
            <form className="settings-section" onSubmit={saveSettings}>
                <h2>Restaurant information</h2>
                {feedback && <p className={feedback.type === "error" ? "form-error" : "form-success"} role={feedback.type === "error" ? "alert" : "status"}>{feedback.message}</p>}
                <label htmlFor="settings-name">Restaurant name</label>
                <input id="settings-name" value={form.name || ""} onChange={event => change("name", event.target.value)} required />
                <label htmlFor="settings-phone">Phone</label>
                <input id="settings-phone" type="tel" value={form.phone || ""} onChange={event => change("phone", event.target.value)} />
                <label htmlFor="settings-address">Address</label>
                <textarea id="settings-address" value={form.address || ""} onChange={event => change("address", event.target.value)} />
                <label htmlFor="settings-footer">Receipt footer</label>
                <textarea id="settings-footer" value={form.receiptFooter || ""} onChange={event => change("receiptFooter", event.target.value)} maxLength={240} />
                {isOwner && <fieldset className="settings-billing">
                    <legend>Billing configuration</legend>
                    <label htmlFor="settings-gst-number">GST number</label>
                    <input id="settings-gst-number" value={form.gstNumber || ""} onChange={event => change("gstNumber", event.target.value)} />
                    <label htmlFor="settings-gst-rate">GST rate (%)</label>
                    <input id="settings-gst-rate" type="number" min="0" max="100" step="0.01" value={Number(form.gstRate ?? 0.18) * 100} onChange={event => change("gstRate", Number(event.target.value) / 100)} />
                    <label htmlFor="settings-currency">Currency</label>
                    <select id="settings-currency" value={form.currency || "INR"} onChange={event => change("currency", event.target.value)}>
                        <option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option>
                    </select>
                </fieldset>}
                {!isOwner && <p className="settings-note">Your Manager access allows editing restaurant contact details. Tax and currency settings are Owner controlled.</p>}
                <div className="settings-actions"><button type="submit">Save settings</button><button type="button" onClick={() => { setForm(restaurantSettings); setFeedback(null); }}>Reset</button></div>
            </form>
            {can("waiters:manage") && <section className="settings-section waiter-registry">
                <h2>Waiter accounts</h2>
                <p>Add or activate Waiter accounts. Waiters sign in with the registered username in this demo.</p>
                {waiterFeedback && <p className={waiterFeedback.type === "error" ? "form-error" : "form-success"} role={waiterFeedback.type === "error" ? "alert" : "status"}>{waiterFeedback.message}</p>}
                <form onSubmit={saveWaiter}>
                    <label htmlFor="waiter-name">Employee name</label>
                    <input id="waiter-name" value={waiterName} onChange={event => setWaiterName(event.target.value)} required />
                    <label htmlFor="waiter-username">Login username</label>
                    <input id="waiter-username" value={waiterUsername} onChange={event => setWaiterUsername(event.target.value)} required />
                    <button type="submit">Add Waiter</button>
                </form>
                {waiters.length === 0 ? <p>No Waiter accounts yet.</p> : <ul className="waiter-account-list">
                    {waiters.map(waiter => <li key={waiter.id}>
                        <span><strong>{waiter.name}</strong><small>{waiter.username} · {waiter.active === false ? "Inactive" : "Active"}</small></span>
                        <button type="button" onClick={() => toggleWaiter(waiter)}>{waiter.active === false ? "Activate" : "Deactivate"}</button>
                    </li>)}
                </ul>}
            </section>}
        </main>
    );
}

export default Settings;
