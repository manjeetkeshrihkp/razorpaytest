export function inr(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

export function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("hk_cart") || "{}");
  } catch {
    return {};
  }
}

export function saveCart(cart) {
  localStorage.setItem("hk_cart", JSON.stringify(cart));
}

export function cartCount(cart) {
  return Object.values(cart).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

export function cartSubtotal(cart) {
  return Object.values(cart).reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
}

export function cartMrpTotal(cart) {
  return Object.values(cart).reduce((sum, item) => {
    const mrp = Number(item.mrp) || Number(item.price) || 0;
    return sum + mrp * (Number(item.qty) || 0);
  }, 0);
}

export function cartSavings(cart) {
  const mrp = cartMrpTotal(cart);
  const subtotal = cartSubtotal(cart);
  return Math.max(0, mrp - subtotal);
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
