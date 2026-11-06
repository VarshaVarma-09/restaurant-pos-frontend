export const ROLES = ["Waiter", "Cashier", "Manager", "Owner", "Kitchen Staff"];

export const PERMISSIONS = {
    Waiter: ["dashboard:view", "orders:view", "orders:viewAssigned", "orders:create", "orders:addItems", "notifications:own", "kitchen:serve", "tables:view", "menu:view"],
    Cashier: ["dashboard:view", "dashboard:financial", "orders:view", "tables:view", "menu:view", "billing:view", "billing:manage", "reports:limited"],
    Manager: ["dashboard:view", "dashboard:financial", "orders:view", "orders:create", "orders:addItems", "orders:manage", "kitchen:view", "kitchen:update", "kitchen:serve", "kitchen:cancel", "tables:view", "tables:manage", "menu:view", "menu:manage", "billing:view", "billing:manage", "reports:full", "reports:itemwise", "notifications:manage", "waiters:manage", "settings:limited"],
    Owner: ["dashboard:view", "dashboard:financial", "orders:view", "orders:create", "orders:addItems", "orders:manage", "kitchen:view", "kitchen:update", "kitchen:serve", "kitchen:cancel", "tables:view", "tables:manage", "menu:view", "menu:manage", "billing:view", "billing:manage", "reports:full", "reports:itemwise", "notifications:manage", "waiters:manage", "settings:full"],
    "Kitchen Staff": ["dashboard:view", "kitchen:view", "kitchen:update"]
};

const ROUTE_PERMISSIONS = {
    "/": "dashboard:view",
    "/orders": "orders:view",
    "/orders/new": "orders:create",
    "/kitchen": "kitchen:view",
    "/tables": "tables:view",
    "/menu": "menu:view",
    "/billing": "billing:view",
    "/reports": "reports:limited",
    "/settings": "settings:limited"
};

export function hasPermission(role, permission) {
    return Boolean(PERMISSIONS[role]?.includes(permission));
}

export function canAccessRoute(role, pathname) {
    const route = pathname === "/orders/new" ? "/orders/new" : pathname;
    const permission = ROUTE_PERMISSIONS[route];
    if (!permission) return false;
    if (route === "/reports") {
        return hasPermission(role, "reports:limited") || hasPermission(role, "reports:full");
    }
    if (route === "/settings") {
        return hasPermission(role, "settings:limited") || hasPermission(role, "settings:full");
    }
    return hasPermission(role, permission);
}

export function getStoredUser() {
    try {
        const storage = globalThis.localStorage;
        const value = storage?.getItem("currentUser");
        const user = value ? JSON.parse(value) : null;
        if (!user || !ROLES.includes(user.role) || typeof user.username !== "string") return null;
        if (user.role === "Waiter") {
            const storedState = JSON.parse(storage?.getItem("restaurantPosState") || "{}");
            const staff = storedState?.data?.waiters;
            const waiter = Array.isArray(staff) && staff.find(record =>
                record.active !== false && (record.id === user.id || record.username?.trim().toLowerCase() === user.username.trim().toLowerCase())
            );
            if (!waiter) return null;
            return { ...user, id: waiter.id, userId: waiter.id, name: waiter.name, username: waiter.username };
        }
        const stableId = user.id || `user_${user.role.toLowerCase().replace(/\s+/g, "_")}_${encodeURIComponent(user.username.trim().toLowerCase())}`;
        return { ...user, id: stableId, userId: stableId, name: user.name || user.username };
    } catch {
        return null;
    }
}
