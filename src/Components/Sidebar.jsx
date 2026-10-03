import { Link } from "react-router-dom";

function Sidebar() {
    const currentUser = JSON.parse(
        localStorage.getItem("currentUser")
    );

    const role = currentUser?.role;

    function logout() {
        localStorage.removeItem("currentUser");
        window.location.href = "/login";
    }

    return (
        <div className="sidebar">
            <h2>Restaurant POS</h2>

            {currentUser && (
                <div className="user-info">
                    <p>{currentUser.username}</p>
                    <p>{currentUser.role}</p>
                </div>
            )}

            <Link to="/">Dashboard</Link>

            {(role === "Waiter" ||
                role === "Cashier" ||
                role === "Manager" ||
                role === "Owner") && (
                <>
                    <Link to="/orders">Orders</Link>
                    <Link to="/tables">Tables</Link>
                </>
            )}

            {(role === "Cashier" ||
                role === "Manager" ||
                role === "Owner") && (
                <Link to="/billing">Billing</Link>
            )}

            {(role === "Manager" ||
                role === "Owner") && (
                <Link to="/reports">Reports</Link>
            )}

            {role === "Owner" && (
                <>
                    <Link to="/menu">Menu</Link>
                    <Link to="/settings">Settings</Link>
                </>
            )}

            <button onClick={logout}>
                Logout
            </button>
        </div>
    );
}

export default Sidebar;