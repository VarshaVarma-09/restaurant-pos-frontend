import React from "react";
import "./App.css";

import Sidebar from "./Components/Sidebar";

import Dashboard from "./Pages/Dashboard";
import Orders from "./Pages/Orders";
import Tables from "./Pages/Tables";
import Menu from "./Pages/Menu";
import Billing from "./Pages/Billing";
import Reports from "./Pages/Reports";
import Settings from "./Pages/Settings";
import NewOrder from "./Pages/NewOrder";
import Login from "./Pages/Login";

import {
    BrowserRouter,
    Routes,
    Route,
    useLocation
} from "react-router-dom";


function Layout() {

    const location = useLocation();

    return (
        <div className="app">

            {location.pathname !== "/login" && <Sidebar />}

            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/tables" element={<Tables />} />
                <Route path="/menu" element={<Menu />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/orders/new" element={<NewOrder />} />
                <Route path="/login" element={<Login />} />
            </Routes>

        </div>
    );
}


function App() {
    return (
        <BrowserRouter>
            <Layout />
        </BrowserRouter>
    );
}

export default App;