import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Login() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("Waiter");

    const navigate = useNavigate();

    function handleLogin() {
        if (!username || !password) {
            alert("Please enter username and password.");
            return;
        }

        localStorage.setItem(
            "currentUser",
            JSON.stringify({
                username,
                role
            })
        );

        navigate("/");
    }

    return (
        <div className="login-page">
            <div className="login-box">
                <h1>Restaurant POS</h1>

                <h2>Login</h2>

                <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={e =>
                        setUsername(e.target.value)
                    }
                />

                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={e =>
                        setPassword(e.target.value)
                    }
                />

                <select
                    value={role}
                    onChange={e =>
                        setRole(e.target.value)
                    }
                >
                    <option value="Waiter">Waiter</option>
                    <option value="Cashier">Cashier</option>
                    <option value="Manager">Manager</option>
                    <option value="Owner">Owner</option>
                </select>

                <button onClick={handleLogin}>
                    Login
                </button>
            </div>
        </div>
    );
}

export default Login;