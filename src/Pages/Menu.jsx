import { useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";

function Menu() {
    const { menuItems, setMenuItems } = useRestaurant();
    const [name, setName] = useState("");
    const [price, setPrice] = useState("");
    const [editingId, setEditingId] = useState(null);

    function addItem() {
        if (!name || !price) {
            alert("Please enter item name and price.");
            return;
        }

        const newItem = {
            id: Date.now(),
            name: name,
            price: Number(price),
            available: true
        };

        setMenuItems(prevItems => [...prevItems, newItem]);

        setName("");
        setPrice("");
    }
    function startEdit(item) {
    setEditingId(item.id);
    setName(item.name);
    setPrice(item.price);
}
function updateItem() {
    if (!name || !price) {
        alert("Please enter item name and price.");
        return;
    }

    setMenuItems(prevItems =>
        prevItems.map(item =>
            item.id === editingId
                ? {
                    ...item,
                    name: name,
                    price: Number(price)
                }
                : item
        )
    );

    setEditingId(null);
    setName("");
    setPrice("");
}
function deleteItem(id) {
    setMenuItems(prevItems =>
        prevItems.filter(item => item.id !== id)
    );
}
function toggleAvailability(id) {
    setMenuItems(prevItems =>
        prevItems.map(item =>
            item.id === id
                ? { ...item, available: !item.available }
                : item
        )
    );
}

    return (
        <div className="page">
            <h1>Menu</h1>
            <p>Manage restaurant food items and categories</p>
            <div className="add-menu-item">
    <input
        type="text"
        placeholder="Food item name"
        value={name}
        onChange={(e) => setName(e.target.value)}
    />

    <input
        type="number"
        placeholder="Price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
    />
    <button onClick={editingId ? updateItem : addItem}>
    {editingId ? "Update Item" : "Add Item"}
</button>
</div>
            <div className="menu-list">
                {menuItems.map(item => (
                    <div className="menu-card" key={item.id}>
                        <h3>{item.name}</h3>
                        <p>₹{item.price}</p>
                        <p>
                            {item.available ? "Available" : "Unavailable"}
                        </p>
                        <button onClick={() => startEdit(item)}>
    Edit
</button>
                        <button onClick={() => deleteItem(item.id)}>
    Delete
</button>
                        <button onClick={() => toggleAvailability(item.id)}>
    {item.available ? "Mark Unavailable" : "Mark Available"}
</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default Menu;