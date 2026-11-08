import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../Context/useAuth";
import { ROLES } from "../auth/permissions";
import { useRestaurant } from "../Context/RestaurantContext";
import RestaurantLogo from "../Components/RestaurantLogo";

function Login() {
    const location = useLocation();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("Manager");
    const [error, setError] = useState(location.state?.sessionMessage || "");
    const { user, login } = useAuth();
    const navigate = useNavigate();
    const { restaurantSettings } = useRestaurant();

    if (user) return <Navigate to="/" replace />;

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        if (!password.trim()) {
            setError("Enter a password to continue.");
            return;
        }
        try {
            await login(username, password, role);
            const destination = location.state?.from?.pathname || "/";
            navigate(destination, { replace: true });
        } catch (loginError) {
            setError(loginError.message);
        }
    }

    return (
        <main className="login-page login-page-refined">
            <section className="login-panel" aria-labelledby="login-heading">
                <header className="login-brand">
                    <RestaurantLogo size={46} />
                    <span className="login-brand-copy">
                        <strong>Restaurant POS</strong>
                        <small>{restaurantSettings.name || "Service workspace"}</small>
                    </span>
                </header>
                <div className="login-intro-block">
                    <p className="login-kicker">Staff access</p>
                    <h1 id="login-heading">Welcome back</h1>
                    <p>Sign in to continue to your restaurant workspace.</p>
                </div>
                <form className="login-box" onSubmit={handleSubmit}>
                    {error && <p className="form-error" role="alert">{error}</p>}
                    <label htmlFor="login-username">Username</label>
                    <input id="login-username" type="text" autoComplete="username" value={username}
                        onChange={event => setUsername(event.target.value)} required />
                    <label htmlFor="login-password">Password</label>
                    <input id="login-password" type="password" autoComplete="current-password" value={password}
                        onChange={event => setPassword(event.target.value)} required />
                    <label htmlFor="login-role">Your role</label>
                    <select id="login-role" value={role} onChange={event => setRole(event.target.value)}>
                        {ROLES.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <p className="login-demo-note">Your account role and password are verified by the restaurant server.</p>
                    <button type="submit">Sign in to workspace</button>
                </form>
            </section>
        </main>
    );
}

export default Login;
