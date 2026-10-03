import { useRestaurant } from "../Context/RestaurantContext";

function Reports() {
    const { orders } = useRestaurant();

    const totalOrders = orders.length;

    const completedOrders = orders.filter(
        order => order.status === "Completed"
    ).length;

    const paidOrders = orders.filter(
        order => order.paymentStatus === "Paid"
    );

    const totalSales = paidOrders.reduce(
        (sum, order) => sum + order.total,
        0
    );

    const cashSales = paidOrders
        .filter(order => order.paymentMethod === "Cash")
        .reduce((sum, order) => sum + order.total, 0);

    const upiSales = paidOrders
        .filter(order => order.paymentMethod === "UPI")
        .reduce((sum, order) => sum + order.total, 0);

    const cardSales = paidOrders
        .filter(order => order.paymentMethod === "Card")
        .reduce((sum, order) => sum + order.total, 0);

    return (
        <div className="page">
            <h1>Reports</h1>
            <p>View restaurant sales and order reports.</p>

            <div className="report-cards">

                <div className="report-card">
                    <h3>Total Orders</h3>
                    <h2>{totalOrders}</h2>
                </div>

                <div className="report-card">
                    <h3>Completed Orders</h3>
                    <h2>{completedOrders}</h2>
                </div>

                <div className="report-card">
                    <h3>Paid Orders</h3>
                    <h2>{paidOrders.length}</h2>
                </div>

                <div className="report-card">
                    <h3>Total Sales</h3>
                    <h2>₹{totalSales}</h2>
                </div>

            </div>

            <div className="payment-report">
                <h2>Sales by Payment Method</h2>

                <p>Cash: ₹{cashSales}</p>
                <p>UPI: ₹{upiSales}</p>
                <p>Card: ₹{cardSales}</p>
            </div>
        </div>
    );
}

export default Reports;