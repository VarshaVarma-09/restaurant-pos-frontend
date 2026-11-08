import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../Context/useAuth";
import { useRestaurant } from "../Context/RestaurantContext";
import RestaurantLogo from "./RestaurantLogo";

const NAV_ITEMS = [
    { label: "Dashboard", to: "/", permission: "dashboard:view", icon: "dashboard" },
    { label: "Orders", to: "/orders", permission: "orders:view", icon: "orders" },
    { label: "Kitchen", to: "/kitchen", permission: "kitchen:view", icon: "kitchen" },
    { label: "Tables", to: "/tables", permission: "tables:view", icon: "tables" },
    { label: "Menu", to: "/menu", permission: "menu:view", icon: "menu" },
    { label: "Billing", to: "/billing", permission: "billing:view", icon: "billing" },
    { label: "Reports", to: "/reports", permission: "reports:limited", alternatePermission: "reports:full", icon: "reports" },
    { label: "Settings", to: "/settings", permission: "settings:limited", alternatePermission: "settings:full", icon: "settings" },
    { label: "AI Assistant", to: "/assistant", permission: "assistant:use", icon: "assistant" }
];

function NavigationIcon({ name }) {
    const paths = {
        dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
        orders: <><path d="M8 4h8l3 3v13H5V4h3Z" /><path d="M8 4v4h8V4M8 12h8M8 16h5" /></>,
        kitchen: <><path d="M7 3v6M10 3v6M13 3v6M10 9v12M18 3c2 2 2 5 0 7v11" /></>,
        tables: <><path d="M4 5h16v7H4zM6 12v8M18 12v8M4 16h16" /></>,
        menu: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z" /><path d="M4 5v17M8 7h8M8 11h8" /></>,
        billing: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
        reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
        settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
        assistant: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>
    };

    return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Sidebar() {
    const { user, logout, can } = useAuth();
    const { restaurantSettings } = useRestaurant();
    const navigate = useNavigate();
    const visibleItems = NAV_ITEMS.filter(item =>
        !(item.to === "/" && user?.role === "Kitchen Staff") &&
        (can(item.permission) || (item.alternatePermission && can(item.alternatePermission)))
    );
    const displayName = user?.name || user?.username || "Staff member";
    const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

    return (
        <aside className="sidebar">
            <div className="sidebar-brand">
                <RestaurantLogo size={38} inverse />
                <span className="brand-copy">
                    <strong>Restaurant POS</strong>
                    <small>{restaurantSettings.name || "Service workspace"}</small>
                </span>
            </div>

            <nav className="sidebar-nav" aria-label="Main navigation">
                <p className="sidebar-section-label">Workspace</p>
                {visibleItems.map(item => (
                    <NavLink key={item.to} to={item.to} end>
                        <NavigationIcon name={item.icon} />
                        <span>{item.label === "Kitchen" && user?.role === "Kitchen Staff" ? "Kitchen Dashboard" : item.label}</span>
                    </NavLink>
                ))}
            </nav>

            <div className="sidebar-footer">
                {user && <div className="user-info">
                    <span className="user-avatar" aria-hidden="true">{initials}</span>
                    <span className="user-info-copy"><strong>{displayName}</strong><small>{user.role}</small></span>
                </div>}
                {user && <button className="sidebar-logout" type="button" onClick={async () => { await logout(); navigate("/login", { replace: true }); }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></svg>
                    <span>Sign out</span>
                </button>}
            </div>
        </aside>
    );
}

export default Sidebar;
