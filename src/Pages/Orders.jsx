import { useState } from "react";
import { Link } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";

function Orders() {
    const { orders, setOrders, setTables } = useRestaurant();

    const [showHistory, setShowHistory] = useState(false);

    function changeStatus(id) {
        setOrders(prevOrders =>
            prevOrders.map(order => {
                if (order.id !== id) {
                    return order;
                }

                const newStatus =
                    order.status === "Pending"
                        ? "Preparing"
                        : order.status === "Preparing"
                        ? "Ready"
                        : order.status === "Ready"
                        ? "Completed"
                        : "Completed";

                // When order is completed, make its table available
                if (
                    newStatus === "Completed" &&
                    order.status !== "Completed"
                ) {
                    setTables(prevTables =>
                        prevTables.map(table =>
                            table.id === Number(order.table)
                                ? {
                                    ...table,
                                    status: "Available"
                                }
                                : table
                        )
                    );
                }

                return {
                    ...order,
                    status: newStatus
                };
            })
        );
    }

    const activeOrders = orders.filter(
        order => order.status !== "Completed"
    );

    const completedOrders = orders.filter(
        order => order.status === "Completed"
    );

    const displayedOrders = showHistory
        ? completedOrders
        : activeOrders;

    return (
        <div className="page">
            <h1>Orders</h1>

            <p>
                Create and manage restaurant orders.
            </p>

            <div className="order-actions">
                <Link to="/orders/new">
                    + New Order
                </Link>

                <button
                    onClick={() => setShowHistory(!showHistory)}
                >
                    {showHistory
                        ? "Active Orders"
                        : "Order History"}
                </button>
            </div>

            <div className="orders-list">
                <h2>
                    {showHistory
                        ? "Order History"
                        : "Active Orders"}
                </h2>

                {displayedOrders.length === 0 ? (
                    <p>
                        {showHistory
                            ? "No completed orders."
                            : "No active orders."}
                    </p>
                ) : (
                    displayedOrders.map((order, index) => (
                        <div
                            className="order-card"
                            key={order.id}
                        >
                            <h3>
                                Order #{index + 1}
                            </h3>

                            <p>
                                Customer: {order.customerName}
                            </p>

                            <p>
                                Phone: {order.customerPhone}
                            </p>

                            <p>
                                Table: {order.table}
                            </p>

                            <p>
                                Status: {order.status}
                            </p>

                            <h4>Items:</h4>

                            {order.items.map(
                                (item, itemIndex) => (
                                    <p key={itemIndex}>
                                        {item.name} ×{" "}
                                        {item.quantity} = ₹
                                        {item.price *
                                            item.quantity}
                                    </p>
                                )
                            )}

                            <h3>
                                Total: ₹{order.total}
                            </h3>

                            <p>
                                Payment:{" "}
                                {order.paymentStatus ||
                                    "Unpaid"}
                            </p>

                            {order.paymentMethod && (
                                <p>
                                    Method:{" "}
                                    {order.paymentMethod}
                                </p>
                            )}

                            {!showHistory && (
                                <button
                                    onClick={() =>
                                        changeStatus(order.id)
                                    }
                                >
                                    {order.status === "Pending"
                                        ? "Start Preparing"
                                        : order.status ===
                                          "Preparing"
                                        ? "Mark Ready"
                                        : "Complete Order"}
                                </button>
                            )}

                            {showHistory && (
                                <p>
                                    ✓ Order Completed
                                </p>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default Orders;