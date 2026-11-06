import { useCallback, useEffect, useMemo, useState } from "react";
import AuthContext from "./authContext";
import { getStoredUser, hasPermission, ROLES } from "../auth/permissions";

export function AuthProvider({ children }) {
    const [user, setUser] = useState(getStoredUser);
    const [sessionMessage, setSessionMessage] = useState("");

    const login = useCallback((username, role) => {
        if (!String(username || "").trim() || !ROLES.includes(role)) {
            throw new Error("Enter a username and choose a valid role.");
        }
        const normalizedUsername = String(username).trim();
        let nextUser;
        if (role === "Waiter") {
            const storedState = (() => {
                try {
                    return JSON.parse(globalThis.localStorage?.getItem("restaurantPosState") || "{}");
                } catch {
                    return {};
                }
            })();
            const waiter = (Array.isArray(storedState?.data?.waiters) ? storedState.data.waiters : []).find(record =>
                record.active !== false && record.username?.trim().toLowerCase() === normalizedUsername.toLowerCase()
            );
            if (!waiter) throw new Error("This Waiter account is not active. Ask a Manager or Owner to add or activate it.");
            nextUser = { id: waiter.id, userId: waiter.id, username: waiter.username, name: waiter.name, role };
        } else {
            const id = `user_${role.toLowerCase().replace(/\s+/g, "_")}_${encodeURIComponent(normalizedUsername.toLowerCase())}`;
            nextUser = { id, userId: id, username: normalizedUsername, name: normalizedUsername, role };
        }
        try {
            globalThis.localStorage?.setItem("currentUser", JSON.stringify(nextUser));
        } catch {
            // This frontend session can still run in memory when browser storage is blocked.
        }
        setUser(nextUser);
        setSessionMessage("");
        return nextUser;
    }, []);

    const logout = useCallback(() => {
        try {
            globalThis.localStorage?.removeItem("currentUser");
        } catch {
            // Clear the in-memory session even if storage is unavailable.
        }
        setUser(null);
        setSessionMessage("");
    }, []);

    useEffect(() => {
        if (user?.role !== "Waiter") return undefined;
        const revokeWaiterSession = () => {
            setUser(null);
            setSessionMessage("Your Waiter account was deactivated. Contact a Manager or Owner for access.");
            try {
                globalThis.localStorage?.removeItem("currentUser");
            } catch {
                // The in-memory session is still invalidated if browser storage is unavailable.
            }
        };
        const handleWaiterAccountChange = event => {
            if (event.detail?.waiterId === user.id && event.detail.active === false) {
                revokeWaiterSession();
            }
        };
        const handleStorageChange = event => {
            if (event.key !== "restaurantPosState" || !event.newValue) return;
            try {
                const saved = JSON.parse(event.newValue);
                const waiters = saved?.data?.waiters;
                const waiter = Array.isArray(waiters) ? waiters.find(item => item.id === user.id) : null;
                if (!waiter || waiter.active === false) revokeWaiterSession();
            } catch {
                revokeWaiterSession();
            }
        };
        globalThis.addEventListener?.("restaurant-waiter-account-change", handleWaiterAccountChange);
        globalThis.addEventListener?.("storage", handleStorageChange);
        return () => {
            globalThis.removeEventListener?.("restaurant-waiter-account-change", handleWaiterAccountChange);
            globalThis.removeEventListener?.("storage", handleStorageChange);
        };
    }, [user]);

    const can = useCallback(permission => hasPermission(user?.role, permission), [user?.role]);
    const value = useMemo(() => ({ user, login, logout, can, sessionMessage }), [user, login, logout, can, sessionMessage]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
