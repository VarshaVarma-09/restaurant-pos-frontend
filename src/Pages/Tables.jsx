
import { useNavigate } from "react-router-dom";
import { useRestaurant } from "../Context/RestaurantContext";

function Tables() {
    const navigate = useNavigate();
    const { tables, setTables } = useRestaurant();

    function changeStatus(id) {
        setTables(
            tables.map(table => {
                if (table.id !== id) {
                    return table;
                }

                let newStatus;

                if (table.status === "Available") {
                    newStatus = "Occupied";
                } else if (table.status === "Occupied") {
                    newStatus = "Reserved";
                } else {
                    newStatus = "Available";
                }

                return {
                    ...table,
                    status: newStatus
                };
            })
        );
    }

    return (
        <div className="page">
            <h1>Tables</h1>
            <p>View and manage restaurant tables.</p>

            <div className="tables-grid">
                {tables.map(table => (
                    <div className="table-card" key={table.id}>
                        <h2>Table {table.id}</h2>

                        <p className={`table-status ${table.status.toLowerCase()}`}>
                            {table.status}
                        </p>

                        <button onClick={() => changeStatus(table.id)}>
                            Change Status
                        </button>

                        {table.status === "Available" && (
                            <button
                                onClick={() =>
                                    navigate(`/orders/new?table=${table.id}`)
                                }
                            >
                                New Order
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default Tables;