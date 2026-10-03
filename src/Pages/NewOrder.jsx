import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";

function NewOrder() {
    const {
        tables,
        setTables,
        setOrders,
        menuItems
    } = useRestaurant();

    const [searchParams] = useSearchParams();

    const tableFromUrl = searchParams.get("table");

    const [selectedTable, setSelectedTable] = useState(
        tableFromUrl || ""
    );

    const [orderItems, setOrderItems] = useState([]);
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");

    function addToOrder(name, price) {
        const existingItem = orderItems.find(
            item => item.name === name
        );

        if (existingItem) {
            setOrderItems(
                orderItems.map(item =>
                    item.name === name
                        ? {
                            ...item,
                            quantity: item.quantity + 1
                        }
                        : item
                )
            );
        } else {
            const newItem = {
                name: name,
                price: price,
                quantity: 1
            };

            setOrderItems([
                ...orderItems,
                newItem
            ]);
        }
    }

    function changeQuantity(index, change) {
        setOrderItems(
            orderItems
                .map((item, i) =>
                    i === index
                        ? {
                            ...item,
                            quantity: item.quantity + change
                        }
                        : item
                )
                .filter(item => item.quantity > 0)
        );
    }

    const total = orderItems.reduce(
        (sum, item) =>
            sum + item.price * item.quantity,
        0
    );

    function placeOrder() {
        if (!customerName || !customerPhone) {
            alert("Please enter customer details.");
            return;
        }

        if (!selectedTable) {
            alert("Please select a table.");
            return;
        }

        if (orderItems.length === 0) {
            alert("Please add at least one food item.");
            return;
        }

        const selectedTableData = tables.find(
            table => table.id === Number(selectedTable)
        );

        if (!selectedTableData) {
            alert("Selected table does not exist.");
            return;
        }

        if (selectedTableData.status !== "Available") {
            alert("This table is not available.");
            return;
        }

        const newOrder = {
            id: Date.now(),
            customerName: customerName,
            customerPhone: customerPhone,
            table: selectedTable,
            items: orderItems,
            total: total,
            status: "Pending",
            paymentStatus: "Unpaid",
            paymentMethod: "",
            createdAt: new Date().toISOString()
        };

        setOrders(prevOrders => [
            ...prevOrders,
            newOrder
        ]);

        setTables(prevTables =>
            prevTables.map(table =>
                table.id === Number(selectedTable)
                    ? {
                        ...table,
                        status: "Occupied"
                    }
                    : table
            )
        );

        alert("Order placed successfully!");
    }

    return (
        <div className="page">
            <h1>New Order</h1>

            <p>
                Create a new restaurant order.
            </p>

            <div className="order-section">
                <h2>Customer Details</h2>

                <input
                    type="text"
                    placeholder="Customer Name"
                    value={customerName}
                    onChange={e =>
                        setCustomerName(e.target.value)
                    }
                />

                <input
                    type="tel"
                    placeholder="Customer Phone"
                    value={customerPhone}
                    onChange={e =>
                        setCustomerPhone(e.target.value)
                    }
                />
            </div>

            <div className="order-section">
                <h2>Select Table</h2>

                <select
                    value={selectedTable}
                    onChange={e =>
                        setSelectedTable(e.target.value)
                    }
                >
                    <option value="">
                        Select an available table
                    </option>

                    {tables
                        .filter(
                            table =>
                                table.status === "Available"
                        )
                        .map(table => (
                            <option
                                key={table.id}
                                value={table.id}
                            >
                                Table {table.id}
                            </option>
                        ))}
                </select>

                {selectedTable && (
                    <p>
                        Selected Table: {selectedTable}
                    </p>
                )}
            </div>

            <div className="order-section">
                <h2>Select Food Items</h2>

                <div className="food-items">
                    {menuItems
                        .filter(item => item.available)
                        .map(item => (
                            <button
                                key={item.id}
                                onClick={() =>
                                    addToOrder(
                                        item.name,
                                        item.price
                                    )
                                }
                            >
                                {item.name} - ₹{item.price}
                            </button>
                        ))}
                </div>
            </div>

            <div className="selected-items">
                <h2>Selected Items</h2>

                {orderItems.map(
                    (item, index) => (
                        <div key={index}>
                            <p>
                                {item.name} - ₹{item.price}
                            </p>

                            <button
                                onClick={() =>
                                    changeQuantity(
                                        index,
                                        -1
                                    )
                                }
                            >
                                -
                            </button>

                            <span>
                                {item.quantity}
                            </span>

                            <button
                                onClick={() =>
                                    changeQuantity(
                                        index,
                                        1
                                    )
                                }
                            >
                                +
                            </button>

                            <p>
                                Item Total: ₹
                                {item.price *
                                    item.quantity}
                            </p>

                            <button
                                onClick={() =>
                                    changeQuantity(
                                        index,
                                        -item.quantity
                                    )
                                }
                            >
                                Remove
                            </button>
                        </div>
                    )
                )}
            </div>

            <div className="order-total">
                <h2>
                    Total: ₹{total}
                </h2>
            </div>

            <button onClick={placeOrder}>
                Place Order
            </button>
        </div>
    );
}

export default NewOrder;