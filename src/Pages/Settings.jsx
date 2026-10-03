import { useState } from "react";
import { useRestaurant } from "../Context/RestaurantContext";

function Settings() {
    const {
        restaurantSettings,
        setRestaurantSettings
    } = useRestaurant();

    const [name, setName] = useState(restaurantSettings.name);
    const [phone, setPhone] = useState(restaurantSettings.phone);
    const [address, setAddress] = useState(restaurantSettings.address);
    const [gstNumber, setGstNumber] = useState(
        restaurantSettings.gstNumber
    );

    function saveSettings() {
        if (!name || !phone || !address) {
            alert("Please fill all required fields.");
            return;
        }

        setRestaurantSettings({
            name,
            phone,
            address,
            gstNumber
        });

        alert("Settings saved successfully!");
    }

    function resetSettings() {
        setName(restaurantSettings.name);
        setPhone(restaurantSettings.phone);
        setAddress(restaurantSettings.address);
        setGstNumber(restaurantSettings.gstNumber);
    }

    return (
        <div className="page">
            <h1>Settings</h1>

            <p>
                Manage your restaurant information and billing settings.
            </p>

            <div className="settings-section">
                <h2>Restaurant Information</h2>

                <label>Restaurant Name</label>

                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Restaurant Name"
                />

                <label>Phone</label>

                <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone Number"
                />

                <label>Address</label>

                <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Restaurant Address"
                />

                <label>GST Number</label>

                <input
                    type="text"
                    value={gstNumber}
                    onChange={(e) => setGstNumber(e.target.value)}
                    placeholder="GST Number"
                />

                <div className="settings-actions">
                    <button onClick={saveSettings}>
                        Save Settings
                    </button>

                    <button onClick={resetSettings}>
                        Reset
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Settings;