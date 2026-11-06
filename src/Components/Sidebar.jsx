import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../Context/useAuth";

function Sidebar() {
    const { user, logout, can } = useAuth();
    const navigate = useNavigate();

    return (
        <div className="sidebar">
            <h2>Restaurant POS</h2>

            {user && (
                <div className="user-info">
                    <p>{user.username}</p>
                    <p>{user.role}</p>
                </div>
            )}

            {user && <>
                {user.role !== "Kitchen Staff" && <NavLink to="/">Dashboard</NavLink>}
                {can("orders:view") && <NavLink to="/orders">Orders</NavLink>}
                {can("kitchen:view") && <NavLink to="/kitchen">{user.role === "Kitchen Staff" ? "Kitchen Dashboard" : "Kitchen"}</NavLink>}
                {can("tables:view") && <NavLink to="/tables">Tables</NavLink>}
                {can("menu:view") && <NavLink to="/menu">Menu</NavLink>}
                {can("billing:view") && <NavLink to="/billing">Billing</NavLink>}
                {(can("reports:limited") || can("reports:full")) && <NavLink to="/reports">Reports</NavLink>}
                {(can("settings:limited") || can("settings:full")) && <NavLink to="/settings">Settings</NavLink>}
                <button onClick={() => { logout(); navigate("/login", { replace: true }); }}>Logout</button>
            </>}
        </div>
    );
}

export default Sidebar;
