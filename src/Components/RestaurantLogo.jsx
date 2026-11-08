function RestaurantLogo({ size = 40, inverse = false, className = "" }) {
    return (
        <svg
            className={`restaurant-logo${inverse ? " restaurant-logo-inverse" : ""}${className ? ` ${className}` : ""}`}
            width={size}
            height={size}
            viewBox="0 0 48 48"
            fill="none"
            role="img"
            aria-label="Restaurant POS logo"
        >
            <rect className="restaurant-logo-tile" x="1" y="1" width="46" height="46" rx="14" />
            <path
                className="restaurant-logo-mark"
                d="M8 11h8.2L24 25.8 31.8 11H40L26.8 37h-5.6L8 11Z"
            />
            <path className="restaurant-logo-cut" d="m18.2 18.6 5.8 10.7 5.8-10.7-5.8 4.2-5.8-4.2Z" />
        </svg>
    );
}

export default RestaurantLogo;
