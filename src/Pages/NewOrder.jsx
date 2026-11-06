import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";

function getOrderItemKey(item) {
    return item.menuItemId ?? item.name;
}

function formatRupees(amount, currency = "INR") {
    return Number.isFinite(amount)
        ? new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount)
        : "Price unavailable";
}

function NewOrder() {
    const { tables, menuItems, createOrder, restaurantSettings } = useRestaurant();
    const currency = restaurantSettings.currency || "INR";
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const submitInProgress = useRef(false);
    const redirectTimeout = useRef(null);

    const tableFromUrl = searchParams.get("table");
    const [orderType, setOrderType] = useState("DineIn");
    const [selectedTable, setSelectedTable] = useState(tableFromUrl || "");
    const [orderItems, setOrderItems] = useState([]);
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    useEffect(() => () => {
        if (redirectTimeout.current !== null) {
            window.clearTimeout(redirectTimeout.current);
        }
    }, []);

    function clearFeedback() {
        setErrorMessage("");
        setSuccessMessage("");
    }

    function addToOrder(menuItem) {
        clearFeedback();

        if (typeof menuItem.name !== "string" || menuItem.name.trim() === "") {
            setErrorMessage("This menu item does not have a valid name.");
            return;
        }

        if ((typeof menuItem.price !== "number" && typeof menuItem.price !== "string") ||
            (typeof menuItem.price === "string" && menuItem.price.trim() === "")) {
            setErrorMessage(`${menuItem.name} does not have a valid price.`);
            return;
        }
        const rawPrice = Number(menuItem.price);
        if (!Number.isFinite(rawPrice) || rawPrice < 0) {
            setErrorMessage(`${menuItem.name} does not have a valid price.`);
            return;
        }

        const unitPrice = Math.round((rawPrice + Number.EPSILON) * 100) / 100;
        const selectedItem = {
            menuItemId: menuItem.id ?? null,
            name: menuItem.name.trim(),
            unitPrice,
            quantity: 1,
            notes: ""
        };
        const itemKey = getOrderItemKey(selectedItem);

        setOrderItems(previousItems => {
            const existingItem = previousItems.find(
                item => getOrderItemKey(item) === itemKey
            );

            if (existingItem) {
                return previousItems.map(item =>
                    getOrderItemKey(item) === itemKey
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }

            return [...previousItems, selectedItem];
        });
    }

    function changeQuantity(itemKey, change) {
        clearFeedback();
        setOrderItems(previousItems => previousItems
            .map(item => getOrderItemKey(item) === itemKey
                ? { ...item, quantity: item.quantity + change }
                : item
            )
            .filter(item => item.quantity > 0)
        );
    }

    const subtotalCents = orderItems.reduce(
        (sum, item) => sum + Math.round((item.unitPrice + Number.EPSILON) * 100) * item.quantity,
        0
    );
    const subtotal = subtotalCents / 100;

    async function placeOrder(event) {
        event.preventDefault();
        clearFeedback();

        if (submitInProgress.current) {
            return;
        }

        if (!customerName.trim() || !customerPhone.trim()) {
            setErrorMessage("Please enter the customer name and phone number.");
            return;
        }

        if (orderType === "DineIn") {
            if (!selectedTable) {
                setErrorMessage("Please select a table for this dine-in order.");
                return;
            }

            const table = tables.find(item => String(item.id) === String(selectedTable));
            if (!table) {
                setErrorMessage("The selected table does not exist. Please choose another table.");
                return;
            }
            if (table.status !== "Available" || table.active === false) {
                setErrorMessage("The selected table is no longer available. Please choose another table.");
                return;
            }
        }

        const validItems = orderItems.length > 0 && orderItems.every(item =>
            typeof item.name === "string" &&
            item.name.trim() !== "" &&
            Number.isFinite(item.unitPrice) &&
            item.unitPrice >= 0 &&
            Number.isSafeInteger(item.quantity) &&
            item.quantity > 0
        );

        if (!validItems) {
            setErrorMessage("Add at least one valid menu item with a positive quantity.");
            return;
        }

        submitInProgress.current = true;
        setIsSubmitting(true);

        try {
            const orderInput = {
                orderType,
                ...(orderType === "DineIn" ? { tableId: selectedTable } : {}),
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                items: orderItems.map(item => ({
                    menuItemId: item.menuItemId,
                    name: item.name,
                    unitPrice: item.unitPrice,
                    quantity: item.quantity,
                    notes: item.notes
                }))
            };

            const createdOrder = await createOrder(orderInput);
            if (createdOrder instanceof Error) {
                throw createdOrder;
            }
            if (!createdOrder || createdOrder.error || createdOrder.ok === false) {
                const returnedError = createdOrder?.error;
                throw new Error(
                    (typeof returnedError === "string" ? returnedError : returnedError?.message) ||
                    "The order could not be created. Please try again."
                );
            }

            setSuccessMessage("Order created. Opening Billing…");
            redirectTimeout.current = window.setTimeout(() => {
                navigate(`/billing?orderId=${encodeURIComponent(createdOrder.id)}`);
            }, 700);
        } catch (error) {
            submitInProgress.current = false;
            setIsSubmitting(false);
            setErrorMessage(error?.message || "Unable to place the order. Please try again.");
        }
    }

    return (
        <div className="page">
            <h1>New Order</h1>
            <p>Create a dine-in or takeaway restaurant order.</p>

            {errorMessage && (
                <p className="form-error" role="alert" aria-live="assertive">
                    {errorMessage}
                </p>
            )}
            {successMessage && (
                <p className="form-success" role="status" aria-live="polite">
                    {successMessage}
                </p>
            )}

            <form onSubmit={placeOrder} noValidate>
                <div className="order-section">
                    <h2>Order Type</h2>
                    <label htmlFor="order-type">Service type</label>
                    <select
                        id="order-type"
                        value={orderType}
                        onChange={event => {
                            clearFeedback();
                            setOrderType(event.target.value);
                        }}
                        disabled={isSubmitting}
                    >
                        <option value="DineIn">Dine-in</option>
                        <option value="Takeaway">Takeaway</option>
                    </select>
                </div>

                <div className="order-section">
                    <h2>Customer Details</h2>
                    <label htmlFor="customer-name">Customer name</label>
                    <input
                        id="customer-name"
                        type="text"
                        placeholder="Customer Name"
                        value={customerName}
                        onChange={event => {
                            clearFeedback();
                            setCustomerName(event.target.value);
                        }}
                        autoComplete="name"
                        required
                        disabled={isSubmitting}
                    />

                    <label htmlFor="customer-phone">Customer phone</label>
                    <input
                        id="customer-phone"
                        type="tel"
                        placeholder="Customer Phone"
                        value={customerPhone}
                        onChange={event => {
                            clearFeedback();
                            setCustomerPhone(event.target.value);
                        }}
                        autoComplete="tel"
                        required
                        disabled={isSubmitting}
                    />
                </div>

                {orderType === "DineIn" && (
                    <div className="order-section">
                        <h2>Select Table</h2>
                        <label htmlFor="order-table">Available table</label>
                        <select
                            id="order-table"
                            value={selectedTable}
                            onChange={event => {
                                clearFeedback();
                                setSelectedTable(event.target.value);
                            }}
                            required
                            disabled={isSubmitting}
                        >
                            <option value="">Select an available table</option>
                            {tables.filter(table => table.active !== false).map(table => (
                                <option
                                    key={table.id}
                                    value={table.id}
                                    disabled={table.status !== "Available"}
                                >
                                    {table.name || `Table ${table.id}`} — {table.status}
                                </option>
                            ))}
                        </select>

                        {selectedTable && (
                            <p>Selected Table: {selectedTable}</p>
                        )}
                    </div>
                )}

                <div className="order-section">
                    <h2>Select Food Items</h2>
                    {menuItems.filter(item => item.available).length === 0 ? (
                        <p>No menu items are currently available.</p>
                    ) : (
                        <div className="food-items">
                            {menuItems
                                .filter(item => item.available)
                                .map(item => (
                                    <button
                                        type="button"
                                        key={item.id ?? item.name}
                                        onClick={() => addToOrder(item)}
                                        disabled={isSubmitting}
                                    >
                                        {item.name} - {formatRupees(Number(item.price), currency)}
                                    </button>
                                ))}
                        </div>
                    )}
                </div>

                <div className="selected-items">
                    <h2>Selected Items</h2>
                    {orderItems.length === 0 ? (
                        <p>No items selected yet.</p>
                    ) : (
                        orderItems.map(item => {
                            const itemKey = getOrderItemKey(item);
                            return (
                                <div key={itemKey}>
                                    <p>
                                        {item.name} — {formatRupees(item.unitPrice, currency)} each
                                    </p>
                                    <button
                                        type="button"
                                        aria-label={`Decrease ${item.name} quantity`}
                                        onClick={() => changeQuantity(itemKey, -1)}
                                        disabled={isSubmitting}
                                    >
                                        −
                                    </button>
                                    <span aria-label={`${item.quantity} selected`}>
                                        {item.quantity}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`Increase ${item.name} quantity`}
                                        onClick={() => changeQuantity(itemKey, 1)}
                                        disabled={isSubmitting}
                                    >
                                        +
                                    </button>
                                    <p>
                                        Item Total: {formatRupees(item.unitPrice * item.quantity, currency)}
                                    </p>
                                    <label>
                                        Special instructions for {item.name}
                                        <input type="text" maxLength="240" value={item.notes || ""}
                                            onChange={event => setOrderItems(previous => previous.map(current =>
                                                getOrderItemKey(current) === itemKey ? { ...current, notes: event.target.value } : current
                                            ))} disabled={isSubmitting} />
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => changeQuantity(itemKey, -item.quantity)}
                                        disabled={isSubmitting}
                                    >
                                        Remove
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="order-total">
                    <h2>Items Subtotal: {formatRupees(subtotal, currency)}</h2>
                    <p>Before GST and any bill discount.</p>
                </div>

                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Placing Order…" : "Place Order"}
                </button>
            </form>
        </div>
    );
}

export default NewOrder;
