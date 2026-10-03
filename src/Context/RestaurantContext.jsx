import { createContext, useContext, useState } from "react";

const RestaurantContext = createContext(null);

export function RestaurantProvider({ children }) {
    const [tables, setTables] = useState([
        { id: 1, status: "Available" },
        { id: 2, status: "Occupied" },
        { id: 3, status: "Available" },
        { id: 4, status: "Occupied" },
        { id: 5, status: "Available" },
        { id: 6, status: "Reserved" }
    ]);
    const [restaurantSettings, setRestaurantSettings] = useState({
    name: "My Restaurant",
    phone: "",
    address: "",
    gstNumber: ""
});

    const [orders, setOrders] = useState([]);
    const [menuItems, setMenuItems] = useState([
    { id: 1, name: "Chicken Biryani", price: 250, available: true },
    { id: 2, name: "Paneer Butter Masala", price: 220, available: true },
    { id: 3, name: "Veg Fried Rice", price: 180, available: true },
    { id: 4, name: "Chicken 65", price: 200, available: true }
]);
    return (
        <RestaurantContext.Provider
            value={{
                tables,
                setTables,
                orders,
                setOrders,
                menuItems,
                setMenuItems,
                restaurantSettings,
                setRestaurantSettings
            }}
        >
            {children}
        </RestaurantContext.Provider>
    );
}

export function useRestaurant() {
    return useContext(RestaurantContext);
}