function moneyToCents(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100);
}

function getMinorAmount(record, minorKey, ...majorKeys) {
    const minor = Number(record?.[minorKey]);
    if (Number.isSafeInteger(minor) && minor >= 0) return minor;
    for (const key of majorKeys) {
        if (record?.[key] !== undefined && record?.[key] !== null) {
            const amount = Number(record[key]);
            return Number.isFinite(amount) && amount >= 0 ? moneyToCents(amount) : 0;
        }
    }
    return 0;
}

export function getPaymentAppliedAmount(payment) {
    return getMinorAmount(payment, "amountAppliedMinor", "amountApplied", "amount") / 100;
}

export function getPaymentTipAmount(payment) {
    return getMinorAmount(payment, "tipMinor", "tipAmount") / 100;
}

export function getPaymentTotalMinor(payment) {
	return getMinorAmount(payment, "totalAmountMinor", "totalAmountReceivedOrCharged", "amountCharged", "amount");
}

export function getPaymentChangeAmount(payment) {
    return getMinorAmount(payment, "changeReturnedMinor", "changeReturned") / 100;
}

export function getCompletedTipsTotal(paymentRecords) {
    const totalMinor = paymentRecords
        .filter(payment => payment.status === "Completed")
        .reduce((sum, payment) => sum + getMinorAmount(payment, "tipMinor", "tipAmount"), 0);
    return Number.isSafeInteger(totalMinor) ? totalMinor / 100 : Number.POSITIVE_INFINITY;
}

export function getCompletedPaymentTotal(paymentRecords, orderId, billId) {
    const totalCents = paymentRecords
        .filter(payment => {
            if (payment.status !== "Completed") return false;
            const hasBillId = Object.prototype.hasOwnProperty.call(payment, "billId");
            if (billId != null) return hasBillId ? payment.billId === billId : payment.orderId === orderId;
            return !hasBillId && payment.orderId === orderId;
        })
        .reduce((sum, payment) => {
            return sum + getMinorAmount(payment, "amountAppliedMinor", "amountApplied", "amount");
        }, 0);
    return Number.isSafeInteger(totalCents) ? totalCents / 100 : Number.POSITIVE_INFINITY;
}
