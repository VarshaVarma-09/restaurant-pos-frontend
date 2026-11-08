import { useEffect, useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";
import { useAuth } from "../Context/useAuth";
import { apiRequest } from "../api";

function Settings() {
    const { restaurantSettings, remoteStateReady, updateRestaurantSettings, waiters, addWaiterAccount, updateWaiterAccountStatus, kitchenStaff, addKitchenStaffAccount, managerAccounts, addManagerAccount } = useRestaurant();
    const { can } = useAuth();
    const isOwner = can("settings:full");
    const canManageStaff = can("waiters:manage");
    const [form, setForm] = useState(null);
    const currentForm = form ?? restaurantSettings;
    const [feedback, setFeedback] = useState(null);
    const [waiterUsername, setWaiterUsername] = useState("");
    const [waiterName, setWaiterName] = useState("");
    const [waiterPassword, setWaiterPassword] = useState("");
    const [waiterFeedback, setWaiterFeedback] = useState(null);
    const [kitchenStaffUsername, setKitchenStaffUsername] = useState("");
    const [kitchenStaffName, setKitchenStaffName] = useState("");
    const [kitchenStaffPassword, setKitchenStaffPassword] = useState("");
    const [kitchenStaffFeedback, setKitchenStaffFeedback] = useState(null);
    const [managerUsername, setManagerUsername] = useState("");
    const [managerName, setManagerName] = useState("");
    const [managerPassword, setManagerPassword] = useState("");
    const [managerFeedback, setManagerFeedback] = useState(null);
    const [resettableStaff, setResettableStaff] = useState([]);
    const [staffLoading, setStaffLoading] = useState(canManageStaff);
    const [staffError, setStaffError] = useState("");
    const [resettingStaffId, setResettingStaffId] = useState(null);
    const [resetPassword, setResetPassword] = useState("");
    const [confirmResetPassword, setConfirmResetPassword] = useState("");
    const [resetFeedback, setResetFeedback] = useState(null);

    useEffect(() => {
        if (!canManageStaff) return undefined;
        let cancelled = false;
        apiRequest("/staff/password-reset")
            .then(result => { if (!cancelled) setResettableStaff(result.users || []); })
            .catch(error => { if (!cancelled) setStaffError(error.message || "Unable to load staff accounts."); })
            .finally(() => { if (!cancelled) setStaffLoading(false); });
        return () => { cancelled = true; };
    }, [canManageStaff]);

    async function saveSettings(event) {
        event.preventDefault();
        if (!remoteStateReady) {
            setFeedback({ type: "error", message: "Restaurant settings are still loading. Please try again." });
            return;
        }
        const name = String(currentForm.name || "").trim();
        const ratePercent = Number(currentForm.gstRate ?? 0.18) * 100;
        if (!name) {
            setFeedback({ type: "error", message: "Restaurant name is required." });
            return;
        }
        if (isOwner && (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100)) {
            setFeedback({ type: "error", message: "GST rate must be between 0 and 100 percent." });
            return;
        }
        try {
            const result = await updateRestaurantSettings({
                name,
                phone: currentForm.phone || "",
                address: currentForm.address || "",
                receiptFooter: currentForm.receiptFooter || "",
                ...(isOwner ? { gstNumber: currentForm.gstNumber || "", gstRate: ratePercent / 100, currency: currentForm.currency || "INR" } : {})
            });
            if (result?.ok === false) throw new Error(result.error || "Settings could not be persisted.");
            setFeedback({ type: "success", message: "Restaurant settings saved. GST and currency changes apply to new bills." });
        } catch (error) {
            setFeedback({ type: "error", message: error.message || "Unable to save settings." });
        }
    }

    function change(key, value) {
        setForm(previous => ({ ...(previous ?? restaurantSettings), [key]: value }));
    }

    async function saveWaiter(event) {
        event.preventDefault();
        try {
            await addWaiterAccount({ username: waiterUsername, name: waiterName, password: waiterPassword });
            setWaiterUsername("");
            setWaiterName("");
            setWaiterPassword("");
            setWaiterFeedback({ type: "success", message: "Waiter account added and activated." });
        } catch (error) {
            setWaiterFeedback({ type: "error", message: error.message || "Unable to add the Waiter account." });
        }
    }

    async function toggleWaiter(waiter) {
        try {
            await updateWaiterAccountStatus(waiter.id, waiter.active === false);
            setWaiterFeedback({ type: "success", message: `${waiter.name} is now ${waiter.active === false ? "active" : "inactive"}.` });
        } catch (error) {
            setWaiterFeedback({ type: "error", message: error.message || "Unable to update the Waiter account." });
        }
    }

    async function saveKitchenStaff(event) {
        event.preventDefault();
        try {
            await addKitchenStaffAccount({ username: kitchenStaffUsername, name: kitchenStaffName, password: kitchenStaffPassword });
            setKitchenStaffUsername("");
            setKitchenStaffName("");
            setKitchenStaffPassword("");
            setKitchenStaffFeedback({ type: "success", message: "Kitchen Staff account added and activated." });
        } catch (error) {
            setKitchenStaffFeedback({ type: "error", message: error.message || "Unable to add the Kitchen Staff account." });
        }
    }

    async function saveManager(event) {
        event.preventDefault();
        try {
            await addManagerAccount({ username: managerUsername, name: managerName, password: managerPassword });
            setManagerUsername("");
            setManagerName("");
            setManagerPassword("");
            setManagerFeedback({ type: "success", message: "Manager account added and activated." });
        } catch (error) {
            setManagerFeedback({ type: "error", message: error.message || "Unable to add the Manager account." });
        }
    }

    async function resetStaffPassword(event, account) {
        event.preventDefault();
        setResetFeedback(null);
        if (resetPassword.length < 8 || resetPassword.length > 128) {
            setResetFeedback({ type: "error", message: "New password must be 8–128 characters." });
            return;
        }
        if (resetPassword !== confirmResetPassword) {
            setResetFeedback({ type: "error", message: "Password confirmation does not match." });
            return;
        }
        try {
            await apiRequest(`/users/${encodeURIComponent(account.id)}/password`, {
                method: "PATCH",
                body: { password: resetPassword, confirmPassword: confirmResetPassword }
            });
            setResetPassword("");
            setConfirmResetPassword("");
            setResettingStaffId(null);
            setResetFeedback({ type: "success", message: `Password reset for ${account.name}.` });
        } catch (error) {
            setResetFeedback({ type: "error", message: error.message || "Unable to reset this password." });
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
                <input id="settings-name" value={currentForm.name || ""} onChange={event => change("name", event.target.value)} required />
                <label htmlFor="settings-phone">Phone</label>
                <input id="settings-phone" type="tel" value={currentForm.phone || ""} onChange={event => change("phone", event.target.value)} />
                <label htmlFor="settings-address">Address</label>
                <textarea id="settings-address" value={currentForm.address || ""} onChange={event => change("address", event.target.value)} />
                <label htmlFor="settings-footer">Receipt footer</label>
                <textarea id="settings-footer" value={currentForm.receiptFooter || ""} onChange={event => change("receiptFooter", event.target.value)} maxLength={240} />
                {isOwner && <fieldset className="settings-billing">
                    <legend>Billing configuration</legend>
                    <label htmlFor="settings-gst-number">GST number</label>
                    <input id="settings-gst-number" value={currentForm.gstNumber || ""} onChange={event => change("gstNumber", event.target.value)} />
                    <label htmlFor="settings-gst-rate">GST rate (%)</label>
                    <input id="settings-gst-rate" type="number" min="0" max="100" step="0.01" value={Number(currentForm.gstRate ?? 0.18) * 100} onChange={event => change("gstRate", Number(event.target.value) / 100)} />
                    <label htmlFor="settings-currency">Currency</label>
                    <select id="settings-currency" value={currentForm.currency || "INR"} onChange={event => change("currency", event.target.value)}>
                        <option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option>
                    </select>
                </fieldset>}
                {!isOwner && <p className="settings-note">Your Manager access allows editing restaurant contact details. Tax and currency settings are Owner controlled.</p>}
                <div className="settings-actions"><button type="submit" disabled={!remoteStateReady}>Save settings</button><button type="button" onClick={() => { setForm(null); setFeedback(null); }}>Reset</button></div>
            </form>
            {canManageStaff && <section className="settings-section waiter-registry staff-password-reset">
                <h2>Staff Management</h2>
                <p>View staff accounts and reset their passwords.</p>
                {staffLoading && <p role="status">Loading staff accounts…</p>}
                {staffError && <p className="form-error" role="alert">{staffError}</p>}
                {resetFeedback && <p className={resetFeedback.type === "error" ? "form-error" : "form-success"} role={resetFeedback.type === "error" ? "alert" : "status"}>{resetFeedback.message}</p>}
                {!staffLoading && !staffError && (resettableStaff.length === 0 ? <p>No staff accounts available.</p> : <ul className="waiter-account-list">
                    {resettableStaff.map(account => <li key={account.id}>
                        <span><strong>{account.name}</strong><small>{account.username} · {account.role} · {account.active === false ? "Inactive" : "Active"}</small></span>
                        {resettingStaffId === account.id ? <form onSubmit={event => resetStaffPassword(event, account)}>
                            <label htmlFor={`staff-new-password-${account.id}`}>New Password</label>
                            <input id={`staff-new-password-${account.id}`} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={resetPassword} onChange={event => setResetPassword(event.target.value)} required />
                            <label htmlFor={`staff-confirm-password-${account.id}`}>Confirm Password</label>
                            <input id={`staff-confirm-password-${account.id}`} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmResetPassword} onChange={event => setConfirmResetPassword(event.target.value)} required />
                            <button type="submit">Save Password</button>
                            <button type="button" onClick={() => { setResettingStaffId(null); setResetPassword(""); setConfirmResetPassword(""); }}>Cancel</button>
                        </form> : <button type="button" onClick={() => { setResetFeedback(null); setResettingStaffId(account.id); }}>Reset Password</button>}
                    </li>)}
                </ul>)}
            </section>}
            {can("waiters:manage") && <section className="settings-section waiter-registry">
                <h2>Waiter accounts</h2>
                <p>Create password-protected Waiter accounts and manage their access.</p>
                {waiterFeedback && <p className={waiterFeedback.type === "error" ? "form-error" : "form-success"} role={waiterFeedback.type === "error" ? "alert" : "status"}>{waiterFeedback.message}</p>}
                <form onSubmit={saveWaiter}>
                    <label htmlFor="waiter-name">Employee name</label>
                    <input id="waiter-name" value={waiterName} onChange={event => setWaiterName(event.target.value)} required />
                    <label htmlFor="waiter-username">Login username</label>
                    <input id="waiter-username" value={waiterUsername} onChange={event => setWaiterUsername(event.target.value)} required />
                    <label htmlFor="waiter-password">Temporary password (10 characters minimum)</label>
                    <input id="waiter-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={waiterPassword} onChange={event => setWaiterPassword(event.target.value)} required />
                    <button type="submit">Add Waiter</button>
                </form>
                {waiters.length === 0 ? <p>No Waiter accounts yet.</p> : <ul className="waiter-account-list">
                    {waiters.map(waiter => <li key={waiter.id}>
                        <span><strong>{waiter.name}</strong><small>{waiter.username} · {waiter.active === false ? "Inactive" : "Active"}</small></span>
                        <button type="button" onClick={() => toggleWaiter(waiter)}>{waiter.active === false ? "Activate" : "Deactivate"}</button>
                    </li>)}
                </ul>}
            </section>}
            {isOwner && <section className="settings-section waiter-registry kitchen-staff-registry">
                <h2>Kitchen Staff accounts</h2>
                <p>Create password-protected Kitchen Staff accounts for the kitchen queue.</p>
                {kitchenStaffFeedback && <p className={kitchenStaffFeedback.type === "error" ? "form-error" : "form-success"} role={kitchenStaffFeedback.type === "error" ? "alert" : "status"}>{kitchenStaffFeedback.message}</p>}
                <form onSubmit={saveKitchenStaff}>
                    <label htmlFor="kitchen-staff-name">Employee name</label>
                    <input id="kitchen-staff-name" value={kitchenStaffName} onChange={event => setKitchenStaffName(event.target.value)} required />
                    <label htmlFor="kitchen-staff-username">Login username</label>
                    <input id="kitchen-staff-username" value={kitchenStaffUsername} onChange={event => setKitchenStaffUsername(event.target.value)} required />
                    <label htmlFor="kitchen-staff-password">Temporary password (10 characters minimum)</label>
                    <input id="kitchen-staff-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={kitchenStaffPassword} onChange={event => setKitchenStaffPassword(event.target.value)} required />
                    <button type="submit">Add Kitchen Staff</button>
                </form>
                {kitchenStaff.length === 0 ? <p>No Kitchen Staff accounts yet.</p> : <ul className="waiter-account-list">
                    {kitchenStaff.map(account => <li key={account.id}>
                        <span><strong>{account.name}</strong><small>{account.username} · Kitchen Staff · {account.active === false ? "Inactive" : "Active"}</small></span>
                    </li>)}
                </ul>}
            </section>}
            {isOwner && <section className="settings-section waiter-registry manager-registry">
                <h2>Manager accounts</h2>
                <p>Create password-protected Manager accounts.</p>
                {managerFeedback && <p className={managerFeedback.type === "error" ? "form-error" : "form-success"} role={managerFeedback.type === "error" ? "alert" : "status"}>{managerFeedback.message}</p>}
                <form onSubmit={saveManager}>
                    <label htmlFor="manager-name">Employee name</label>
                    <input id="manager-name" value={managerName} onChange={event => setManagerName(event.target.value)} required />
                    <label htmlFor="manager-username">Login username</label>
                    <input id="manager-username" value={managerUsername} onChange={event => setManagerUsername(event.target.value)} required />
                    <label htmlFor="manager-password">Temporary password (10 characters minimum)</label>
                    <input id="manager-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={managerPassword} onChange={event => setManagerPassword(event.target.value)} required />
                    <button type="submit">Add Manager</button>
                </form>
                {managerAccounts.length === 0 ? <p>No Manager accounts yet.</p> : <ul className="waiter-account-list">
                    {managerAccounts.map(account => <li key={account.id}>
                        <span><strong>{account.name}</strong><small>{account.username} · Manager · {account.active === false ? "Inactive" : "Active"}</small></span>
                    </li>)}
                </ul>}
            </section>}
        </main>
    );
}

export default Settings;
