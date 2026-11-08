import { useCallback, useEffect, useMemo, useState } from "react";
import AuthContext from "./authContext";
import { hasPermission, ROLES } from "../auth/permissions";
import { apiRequest, getToken } from "../api";

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [sessionMessage, setSessionMessage] = useState("");

    const [authReady, setAuthReady] = useState(false);
    useEffect(() => {
        let active = true;
        const restoreSession = async () => {
            const legacyToken = getToken();
            try {
                let result = await apiRequest('/auth/me', legacyToken ? { token: legacyToken } : {});
                if (legacyToken) {
                    result = await apiRequest('/auth/session', { method: 'POST', token: legacyToken });
                    globalThis.localStorage?.removeItem('restaurantPosToken');
                }
                if (active) setUser({ ...result.user, userId: result.user.id });
            } catch {
                try {
                    globalThis.localStorage?.removeItem('restaurantPosToken');
                    globalThis.localStorage?.removeItem('currentUser');
                } catch { /* In-memory auth state still fails closed when storage is unavailable. */ }
                if (active) setUser(null);
            } finally { if (active) setAuthReady(true); }
        };
        restoreSession();
        return () => { active = false; };
    }, []);

    const login = useCallback(async (username, password, expectedRole) => {
        if (!String(username || '').trim() || !String(password || '') || !ROLES.includes(expectedRole)) throw new Error('Enter your username and password.');
        const { user: authenticatedUser } = await apiRequest('/auth/login', { method: 'POST', body: { username: String(username).trim(), password, expectedRole }, token: '' });
        const nextUser = { ...authenticatedUser, userId: authenticatedUser.id };
        try {
            globalThis.localStorage?.removeItem("restaurantPosToken");
            globalThis.localStorage?.setItem("currentUser", JSON.stringify(nextUser));
        } catch {
            // This frontend session can still run in memory when browser storage is blocked.
        }
        setUser(nextUser);
        globalThis.dispatchEvent?.(new Event('restaurant-auth-change'));
        setSessionMessage("");
        return nextUser;
    }, []);

    const logout = useCallback(async () => {
        try {
            await apiRequest('/auth/logout', { method: 'POST', token: '' });
        } catch {
            // Always clear the local session even if the server cannot be reached.
        } finally {
            try {
                globalThis.localStorage?.removeItem("currentUser");
                globalThis.localStorage?.removeItem("restaurantPosToken");
            } catch {
                // Clear the in-memory session even if storage is unavailable.
            }
            setUser(null);
            globalThis.dispatchEvent?.(new Event('restaurant-auth-change'));
            setSessionMessage("");
        }
    }, []);

    useEffect(() => {
        if (user?.role !== "Waiter") return undefined;
        const revokeWaiterSession = () => {
            setUser(null);
            setSessionMessage("Your Waiter account was deactivated. Contact a Manager or Owner for access.");
            try {
                globalThis.localStorage?.removeItem("currentUser");
                globalThis.localStorage?.removeItem("restaurantPosToken");
            } catch {
                // The in-memory session is still invalidated if browser storage is unavailable.
            }
        };
        const handleWaiterAccountChange = event => {
            if (event.detail?.waiterId === user.id && event.detail.active === false) {
                revokeWaiterSession();
            }
        };
        globalThis.addEventListener?.("restaurant-waiter-account-change", handleWaiterAccountChange);
        return () => {
            globalThis.removeEventListener?.("restaurant-waiter-account-change", handleWaiterAccountChange);
        };
    }, [user]);

    const can = useCallback(permission => hasPermission(user?.role, permission), [user?.role]);
    const value = useMemo(() => ({ user, login, logout, can, sessionMessage, authReady }), [user, login, logout, can, sessionMessage, authReady]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
