import DashboardCard from "../Components/DashboardCard";
import { useRestaurant } from "../Context/RestaurantContext";
import {Link} from "react-router-dom";
function Dashboard(){
    const {orders,tables}=useRestaurant();
    const activeOrders = orders.filter(
    order => order.status !== "Completed"
).length;const today = new Date().toISOString().split("T")[0];

const todaySales = orders
    .filter(
        order =>
            order.paymentStatus === "Paid" &&
            order.createdAt?.split("T")[0] === today
    )
    .reduce((sum, order) => sum + order.total, 0);

const occupiedTables = tables.filter(
    table => table.status === "Occupied"
).length;
    return(
        <div className="dashboard">
            <h1>Dashboard</h1>
            <p>Welcome to Restaurant POS</p>



            <div className="dashboard-cards">
                <DashboardCard title="Today's Sales" value={`₹${todaySales}`} />
                <DashboardCard title="Today's Orders" value={orders.length} />
                <DashboardCard title="Active Orders" value={activeOrders} />
                <DashboardCard title="Tables" value={`${occupiedTables}/${tables.length}`} />
            </div>

            <div className="quick-actions">
                <h2>Quick-Actions</h2>
                <div className="action-buttons">                
                <Link to="/orders/new">+ New Order</Link>
                <Link to="/tables">View Tables</Link>
                <Link to="/billing">Billing</Link>
                <Link to="/menu">Menu</Link>
                </div>
            </div>

        </div>
    );
}
export default Dashboard;