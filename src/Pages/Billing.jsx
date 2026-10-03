import { useRestaurant } from "../Context/RestaurantContext";

function Billing() {
    const { orders, setOrders } = useRestaurant();

    // Only unpaid orders are shown on this page.
    // Paid orders stay in `orders`, so Reports still counts them.
    const unpaidOrders = orders.filter(
        order => order.paymentStatus !== "Paid"
    );

    function updateOrder(orderId, changes) {
        setOrders(prevOrders =>
            prevOrders.map(order =>
                order.id === orderId ? { ...order, ...changes } : order
            )
        );
    }

    function changePaymentMethod(orderId, method) {
        updateOrder(orderId, { paymentMethod: method });
    }

    function changeDiscount(orderId, discount) {
        updateOrder(orderId, { discount: Number(discount) });
    }

    function markAsPaid(orderId) {
        updateOrder(orderId, { paymentStatus: "Paid" });
    }

    function calculateSubtotal(order) {
        return order.items.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
        );
    }

    function calculateGST(order) {
        const subtotal = calculateSubtotal(order);
        const discount = order.discount || 0;
        return (subtotal - discount) * 0.18;
    }

    function calculateGrandTotal(order) {
        const subtotal = calculateSubtotal(order);
        const discount = order.discount || 0;
        return subtotal - discount + calculateGST(order);
    }

    return (
        <div className="page">
            <h1>Billing</h1>
            <p>Create and manage customer bills and payments.</p>

            <div className="billing-list">
                <h2>Orders for Billing</h2>

                {unpaidOrders.length === 0 ? (
                    <p>No orders available for billing.</p>
                ) : (
                    unpaidOrders.map(order => (
                        <div className="bill-card" key={order.id}>
                            <h3>Order #{order.id}</h3>
                            <p>Customer: {order.customerName}</p>
                            <p>Table: {order.table}</p>

                            <h4>Items:</h4>
                            {order.items.map((item, index) => (
                                <p key={index}>
                                    {item.name} × {item.quantity} = ₹
                                    {item.price * item.quantity}
                                </p>
                            ))}

                            <hr />

                            <p>
                                Subtotal: ₹{calculateSubtotal(order).toFixed(2)}
                            </p>

                            <label>Discount:</label>
                            <input
                                type="number"
                                min="0"
                                value={order.discount || 0}
                                onChange={e =>
                                    changeDiscount(order.id, e.target.value)
                                }
                            />

                            <p>GST (18%): ₹{calculateGST(order).toFixed(2)}</p>

                            <h3>
                                Grand Total: ₹
                                {calculateGrandTotal(order).toFixed(2)}
                            </h3>

                            <p>
                                Payment Status: {order.paymentStatus || "Unpaid"}
                            </p>

                            <label>Payment Method:</label>
                            <select
                                value={order.paymentMethod || ""}
                                onChange={e =>
                                    changePaymentMethod(order.id, e.target.value)
                                }
                            >
                                <option value="">Select payment method</option>
                                <option value="Cash">Cash</option>
                                <option value="UPI">UPI</option>
                                <option value="Card">Card</option>
                            </select>

                            <button
                                onClick={() => markAsPaid(order.id)}
                                disabled={!order.paymentMethod}
                            >
                                Mark as Paid
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default Billing;