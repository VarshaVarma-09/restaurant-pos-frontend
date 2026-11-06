import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../Context/useAuth";
import { ROLES } from "../auth/permissions";

function Login() {
    const location = useLocation();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("Manager");
    const [error, setError] = useState(location.state?.sessionMessage || "");
    const { user, login } = useAuth();
    const navigate = useNavigate();

    if (user) return <Navigate to="/" replace />;

    function handleSubmit(event) {
        event.preventDefault();
        setError("");
        if (!password.trim()) {
            setError("Enter a password to continue.");
            return;
        }
        try {
            login(username, role);
            const destination = location.state?.from?.pathname || "/";
            navigate(destination, { replace: true });
        } catch (loginError) {
            setError(loginError.message);
        }
    }

    return (
        <div className="login-page">
            <form className="login-box" onSubmit={handleSubmit}>
                <h1>Restaurant POS</h1>
                <h2>Sign in</h2>
                {error && <p className="form-error" role="alert">{error}</p>}
                <label htmlFor="login-username">Username</label>
                <input id="login-username" type="text" autoComplete="username" value={username}
                    onChange={event => setUsername(event.target.value)} required />
                <label htmlFor="login-password">Password</label>
                <input id="login-password" type="password" autoComplete="current-password" value={password}
                    onChange={event => setPassword(event.target.value)} required />
                <label htmlFor="login-role">Role</label>
                <select id="login-role" value={role} onChange={event => setRole(event.target.value)}>
                    {ROLES.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
                <p className="login-demo-note">Demo frontend sign-in only. Passwords are not verified, and browser-stored roles are not secure authentication. Do not use this frontend as production access control; the backend must verify credentials and authorize each operation. Restaurant data is stored in this browser, so simultaneous terminals require the backend database and transactional updates.</p>
                <button type="submit">Sign in</button>
            </form>
        </div>
    );
}

export default Login;
