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
import Kitchen from "./Pages/Kitchen";
import AIAssistant from "./Pages/AIAssistant";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./Context/AuthProvider";
import { useAuth } from "./Context/useAuth";
import { canAccessRoute } from "./auth/permissions";
import { useRestaurant } from "./Context/RestaurantContext";

function ProtectedRoute({ children }) {
    const location = useLocation();
    const { user, sessionMessage, authReady } = useAuth();
    const { remoteStateReady, remoteStateError, retryRemoteState } = useRestaurant();
    if (!authReady) return <main className="page" aria-busy="true">Loading session…</main>;
    if (!user) return <Navigate to="/login" replace state={{ from: location, ...(sessionMessage ? { sessionMessage } : {}) }} />;
    if (remoteStateError) return <main className="page" role="alert"><h1>Restaurant data unavailable</h1><p>{remoteStateError}</p><button type="button" onClick={retryRemoteState}>Retry loading data</button></main>;
    if (!remoteStateReady) return <main className="page" aria-busy="true">Loading restaurant data…</main>;
    if (!canAccessRoute(user.role, location.pathname)) {
        return <main className="page"><h1>Access denied</h1><p>Your role does not have access to this page.</p><NavLink to="/">Return to dashboard</NavLink></main>;
    }
    return children;
}

function Layout() {
    const location = useLocation();
    const { storageError } = useRestaurant();

    return (
        <div className="app">
            {location.pathname !== "/login" && <Sidebar />}
            {storageError && <p className="form-error" role="alert" style={{ position: "fixed", top: 12, right: 12, zIndex: 20, maxWidth: "min(600px, calc(100vw - 24px))" }}>{storageError}</p>}
            <Routes>
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
                <Route path="/kitchen" element={<ProtectedRoute><Kitchen /></ProtectedRoute>} />
                <Route path="/tables" element={<ProtectedRoute><Tables /></ProtectedRoute>} />
                <Route path="/menu" element={<ProtectedRoute><Menu /></ProtectedRoute>} />
                <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
                <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/assistant" element={<ProtectedRoute><AIAssistant /></ProtectedRoute>} />
                <Route path="/orders/new" element={<ProtectedRoute><NewOrder /></ProtectedRoute>} />
                <Route path="/login" element={<Login />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </div>
    );
}

function App() {
    return (
        <AuthProvider>
            <BrowserRouter><Layout /></BrowserRouter>
        </AuthProvider>
    );
}

export default App;
