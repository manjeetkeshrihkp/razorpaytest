import { firebaseConfig, razorpayConfig, isFirebaseConfigured, isRazorpayConfigured } from "./firebase-config.js";
import { inr, loadCart, saveCart, cartCount, cartSubtotal, cartMrpTotal, cartSavings, escapeHTML } from "./cart.js";

// Global App State
let db = null;
let seedProducts = [];
let products = [];
let shops = [];
let settings = {
  minOrder: 50,
  deliveryFee: 15,
  freeDeliveryAbove: 299,
  urgentFee: 20,
  storeOpen: true,
  announcement: "",
  storeWhatsApp: "919876543210"
};
let cart = loadCart();
let category = "All";
let sortBy = "popular";
let language = localStorage.getItem("hk_lang") || "en";
let walletBalance = Number(localStorage.getItem("hk_wallet") ?? 150);
let currentLocation = localStorage.getItem("hk_location") || "Gandhi Chowk, Haveli Kharagpur - 811202";
let selectedTip = 20;
let selectedInstructions = new Set(["door"]);
let coupons = [
  { code: "WELCOME50", type: "flat", value: 50, minOrder: 199, desc: "Flat ₹50 OFF on orders above ₹199" },
  { code: "FREEDEL", type: "delivery", value: 15, minOrder: 99, desc: "Free Delivery on orders above ₹99" },
  { code: "KHARAGPUR20", type: "percent", value: 20, minOrder: 150, maxDiscount: 80, desc: "20% OFF up to ₹80" }
];
let appliedCoupon = null;
let activeOrderId = null;
let unsubOrder = null;
let placing = false;
let cancelTimerId = null;
let currentModalProduct = null;

// Fallback dynamic SVG product image
function fallbackImage(label = "Fresh Grocery") {
  const safeLabel = String(label).slice(0, 22);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="500" viewBox="0 0 600 500">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f0fdf4"/>
          <stop offset="100%" stop-color="#dcfce7"/>
        </linearGradient>
      </defs>
      <rect width="600" height="500" fill="url(#grad)"/>
      <circle cx="300" cy="205" r="95" fill="#bbf7d0"/>
      <path d="M300 135c-25 34-56 54-56 91a56 56 0 0 0 112 0c0-37-31-57-56-91Z" fill="#16a34a"/>
      <path d="M300 145v82" stroke="#15803d" stroke-width="8" stroke-linecap="round"/>
      <text x="300" y="385" text-anchor="middle" fill="#166534" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="700">${safeLabel}</text>
      <text x="300" y="420" text-anchor="middle" fill="#15803d" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="600">⚡ 10 MINS DELIVERY</text>
    </svg>
  `)}`;
}

// -------------------------------------------------------------
// FIREBASE INITIALIZATION
// -------------------------------------------------------------
async function initFirebase() {
  if (!isFirebaseConfigured) {
    console.info("Firebase not configured. Running in high-performance local seed mode.");
    return;
  }
  try {
    const [{ initializeApp }, { getFirestore, collection, getDocs, doc, getDoc, addDoc, onSnapshot, query, where, updateDoc, serverTimestamp }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")
    ]);
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    window.hkFirebase = { db, collection, getDocs, doc, getDoc, addDoc, onSnapshot, query, where, updateDoc, serverTimestamp };
    console.info("Firebase connected successfully.");
  } catch (error) {
    console.warn("Firebase initialization error, using local seed data.", error);
  }
}

// -------------------------------------------------------------
// DATA LOADING
// -------------------------------------------------------------
async function loadData() {
  const response = await fetch("./seed.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
  seedProducts = await response.json();
  
  shops = [
    { id: "s1", name: "Kharagpur Staples", commissionPercent: 5 },
    { id: "s2", name: "Fresh Mandi Bazaar", commissionPercent: 5 },
    { id: "s3", name: "Dairy Corner Kharagpur", commissionPercent: 8 },
    { id: "s4", name: "Snack & Munchies Point", commissionPercent: 8 },
    { id: "s5", name: "Jan Aushadhi Medical", commissionPercent: 8 },
    { id: "s6", name: "Town Hot Kitchen", commissionPercent: 8 }
  ];
  products = seedProducts;

  if (db) {
    try {
      const f = window.hkFirebase;
      const [productSnap, shopSnap, settingSnap, couponSnap] = await Promise.all([
        f.getDocs(f.collection(db, "products")),
        f.getDocs(f.collection(db, "shops")),
        f.getDoc(f.doc(db, "settings", "store")),
        f.getDocs(f.collection(db, "coupons"))
      ]);
      if (!productSnap.empty) {
        products = productSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      if (!shopSnap.empty) {
        shops = shopSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      if (settingSnap.exists()) {
        settings = { ...settings, ...settingSnap.data() };
      }
      if (!couponSnap.empty) {
        coupons = couponSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (error) {
      console.warn("Could not load Firestore data; falling back to local seed data", error);
    }
  }

  // Store status
  if (settings.storeOpen === false) {
    document.getElementById("closed-screen").hidden = false;
  }
  if (settings.openTime && settings.closeTime) {
    document.getElementById("closed-hours").textContent = `Open daily ${settings.openTime} to ${settings.closeTime}`;
  }
  if (settings.announcement) {
    const el = document.getElementById("announcement");
    el.innerHTML = `<span>📢 ${escapeHTML(settings.announcement)}</span>`;
    el.hidden = false;
  }

  localStorage.setItem("hk_catalogue", JSON.stringify(products));

  renderCategories();
  renderCategoryMenu();
  renderFlashDeals();
  renderCuratedShelves();
  renderProducts();
  renderCart();
  updateWalletDisplay();
  updateLocationDisplay();
}

// -------------------------------------------------------------
// CATEGORIES & SUBMENUS
// -------------------------------------------------------------
const categories = ["All", "Vegetables", "Fruits", "Dairy & Bakery", "Grocery", "Snacks", "Medicine", "Ready Food"];
const categoryIcons = {
  All: "✦",
  Vegetables: "🥬",
  Fruits: "🍎",
  "Dairy & Bakery": "🥛",
  Grocery: "🌾",
  Snacks: "🍿",
  Medicine: "💊",
  "Ready Food": "🍱"
};

const categoryMenu = [
  ["Fresh vegetables", "🥬", "Vegetables"],
  ["Fresh fruits", "🍎", "Fruits"],
  ["Milk & Curd", "🥛", "Dairy & Bakery"],
  ["Bread & Eggs", "🍞", "Dairy & Bakery"],
  ["Atta & Rice", "🍚", "Grocery"],
  ["Dals & Pulses", "🫘", "Grocery"],
  ["Cooking Oil & Ghee", "🫗", "Grocery"],
  ["Spices & Salt", "🌶️", "Grocery"],
  ["Chips & Namkeen", "🍿", "Snacks"],
  ["Cold Drinks & Juices", "🥤", "Snacks"],
  ["Instant Noodles & Maggi", "🍜", "Snacks"],
  ["Chocolates & Sweets", "🍫", "Snacks"],
  ["Emergency Medicine", "💊", "Medicine"],
  ["First Aid & Bandages", "🩹", "Medicine"],
  ["Hot Ready Food & Samosas", "🍱", "Ready Food"]
].map(([name, icon, productCategory]) => ({ name, icon, productCategory }));

const categorySubmenus = {
  "Fresh vegetables": ["Tomatoes", "Potatoes & Onions", "Leafy Greens", "Green Chillies & Ginger"],
  "Fresh fruits": ["Apples", "Bananas", "Oranges", "Pomegranate & Seasonal"],
  "Milk & Curd": ["Amul Toned Milk", "Full Cream Milk", "Fresh Curd", "Paneer & Butter"],
  "Bread & Eggs": ["White & Brown Bread", "Farm Eggs Pack of 6", "Pav & Buns"],
  "Atta & Rice": ["Aashirvaad Shudh Chakki Atta", "Basmati Rice", "Maida & Suji"],
  "Dals & Pulses": ["Toor Dal", "Chana Dal", "Moong Dal", "Rajma & Kabuli Chana"],
  "Cooking Oil & Ghee": ["Fortune Sunflower Oil", "Mustard Oil", "Amul Pure Cow Ghee"],
  "Spices & Salt": ["Tata Iodized Salt", "Haldi & Mirch Powder", "Garam Masala"],
  "Chips & Namkeen": ["Lays & Kurkure", "Haldiram Aloo Bhujia", "Salted Peanuts"],
  "Cold Drinks & Juices": ["Coca-Cola & Thums Up", "Sprite & Fanta", "Real Fruit Juices"],
  "Instant Noodles & Maggi": ["Maggi 2-Min Masala", "Yippee Noodles", "Macaroni & Pasta"],
  "Chocolates & Sweets": ["Cadbury Dairy Milk", "Gulab Jamun", "Cookies & Cream Biscuits"],
  "Emergency Medicine": ["Paracetamol Tablets", "ORS Hydration Sachet", "Antacid Acidity Relief"],
  "First Aid & Bandages": ["Dettol Liquid", "Band-Aid Strips", "Cotton & Thermometer"],
  "Hot Ready Food & Samosas": ["Hot Potato Samosa", "Veg Biryani Plate", "Kharagpur Veg Thali", "Egg Roll"]
};

function renderCategories() {
  const container = document.getElementById("category-chips");
  if (!container) return;
  container.innerHTML = categories.map(name => {
    const active = category === name ? "active" : "";
    const hiName = {
      All: "सभी",
      Vegetables: "सब्ज़ियां",
      Fruits: "ताज़ा फल",
      "Dairy & Bakery": "डेयरी व अंडे",
      Grocery: "आटा व दालें",
      Snacks: "नाश्ता व पेय",
      Medicine: "दवाईयां",
      "Ready Food": "तैयार खाना"
    }[name] || name;
    return `
      <button class="chip ${active}" data-category="${escapeHTML(name)}" type="button">
        <span class="chip-icon">${categoryIcons[name] || "✦"}</span>
        <span>${escapeHTML(language === "hi" ? hiName : name)}</span>
      </button>
    `;
  }).join("");
}

const categoryMenuHi = {
  "Fresh vegetables": "ताज़ी सब्ज़ियां",
  "Fresh fruits": "ताज़े फल",
  "Milk & Curd": "दूध व दही",
  "Bread & Eggs": "ब्रेड व अंडे",
  "Atta & Rice": "आटा व चावल",
  "Dals & Pulses": "दालें व दाल",
  "Cooking Oil & Ghee": "कुकिंग ऑयल व घी",
  "Spices & Salt": "मसाले व नमक",
  "Chips & Namkeen": "चिप्स व नमकीन",
  "Cold Drinks & Juices": "कोल्ड ड्रिंक्स व जूस",
  "Instant Noodles & Maggi": "मैगी व नूडल्स",
  "Chocolates & Sweets": "चॉकलेट व मिठाई",
  "Emergency Medicine": "ज़रूरी दवाएं",
  "First Aid & Bandages": "फर्स्ट एड व पट्टियां",
  "Hot Ready Food & Samosas": "गरम समोसे व नाश्ता"
};

const categorySubmenusHi = {
  "Tomatoes": "टमाटर",
  "Potatoes & Onions": "आलू व प्याज",
  "Leafy Greens": "हरी पत्तेदार सब्जियां",
  "Green Chillies & Ginger": "हरी मिर्च व अदरक",
  "Apples": "ताज़े सेब",
  "Bananas": "केले",
  "Oranges": "संतरे",
  "Pomegranate & Seasonal": "अनार व मौसमी फल",
  "Amul Toned Milk": "अमूल टोन्ड दूध",
  "Full Cream Milk": "फुल क्रीम दूध",
  "Fresh Curd": "ताज़ा दही",
  "Paneer & Butter": "पनीर व मक्खन",
  "White & Brown Bread": "व्हाइट व ब्राउन ब्रेड",
  "Farm Eggs Pack of 6": "देसी अंडे (6 का पैक)",
  "Pav & Buns": "पाव व बन",
  "Aashirvaad Shudh Chakki Atta": "आशीर्वाद शुद्ध चक्की आटा",
  "Basmati Rice": "बासमती चावल",
  "Maida & Suji": "मैदा व सूजी",
  "Toor Dal": "तूर दाल",
  "Chana Dal": "चना दाल",
  "Moong Dal": "मूंग दाल",
  "Rajma & Kabuli Chana": "राजमा व काबुली चना",
  "Fortune Sunflower Oil": "फॉर्च्यून सनफ्लावर तेल",
  "Mustard Oil": "सरसों का तेल",
  "Amul Pure Cow Ghee": "अमूल शुद्ध गाय का घी"
};

function renderCategoryMenu() {
  const menu = document.getElementById("category-menu");
  if (!menu) return;
  const hi = language === "hi";
  menu.innerHTML = categoryMenu.map((group, index) => {
    const groupName = hi && categoryMenuHi[group.name] ? categoryMenuHi[group.name] : group.name;
    const subItems = categorySubmenus[group.name] || [];
    const countText = hi ? `${subItems.length} प्रकार` : `${subItems.length} varieties`;
    return `
      <article class="category-menu-card">
        <button class="category-menu-title" type="button" data-menu-toggle="${index}" aria-expanded="false">
          <span class="category-menu-icon">${group.icon}</span>
          <span>
            <strong>${escapeHTML(groupName)}</strong>
            <small>${countText}</small>
          </span>
          <span class="category-menu-arrow">▾</span>
        </button>
        <div class="category-submenu" data-submenu="${index}" hidden>
          ${subItems.map(item => {
            const itemLabel = hi && categorySubmenusHi[item] ? categorySubmenusHi[item] : item;
            return `
              <button type="button" class="submenu-item-btn" data-search-term="${escapeHTML(item)}">
                ${escapeHTML(itemLabel)}
              </button>
            `;
          }).join("")}
        </div>
      </article>
    `;
  }).join("");
}

// -------------------------------------------------------------
// FLASH DEALS & CURATED SHELVES
// -------------------------------------------------------------
function renderFlashDeals() {
  const rail = document.getElementById("flash-deals-rail");
  if (!rail) return;
  // Pick items with best discounts or under ₹100
  const deals = products.filter(p => p.mrp && p.mrp > p.price).slice(0, 8);
  rail.innerHTML = deals.map(p => productCard(p, true)).join("");
}

function renderCuratedShelves() {
  const morningRail = document.getElementById("morning-essentials-rail");
  if (morningRail) {
    const morningItems = products.filter(p => p.category === "Dairy & Bakery").slice(0, 6);
    morningRail.innerHTML = morningItems.map(p => productCard(p, true)).join("");
  }
  const farmRail = document.getElementById("farm-fresh-rail");
  if (farmRail) {
    const farmItems = products.filter(p => p.category === "Vegetables" || p.category === "Fruits").slice(0, 6);
    farmRail.innerHTML = farmItems.map(p => productCard(p, true)).join("");
  }
}

// -------------------------------------------------------------
// MAIN PRODUCT GRID & PRODUCT CARDS
// -------------------------------------------------------------
function renderProducts() {
  const query = document.getElementById("search-input").value.trim().toLowerCase();
  let filtered = products.filter(p => {
    const matchCat = category === "All" || p.category === category;
    const matchQuery = !query || `${p.name} ${p.nameHi || ""} ${p.category} ${p.description || ""}`.toLowerCase().includes(query);
    return matchCat && matchQuery;
  });

  if (settings.hideOutOfStock) {
    filtered = filtered.filter(p => p.inStock !== false);
  }

  // Sorting
  if (sortBy === "price-low") {
    filtered.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (sortBy === "price-high") {
    filtered.sort((a, b) => Number(b.price) - Number(a.price));
  } else if (sortBy === "discount") {
    filtered.sort((a, b) => {
      const discA = a.mrp ? (a.mrp - a.price) / a.mrp : 0;
      const discB = b.mrp ? (b.mrp - b.price) / b.mrp : 0;
      return discB - discA;
    });
  } else {
    // Default popularity: rating + stock
    filtered.sort((a, b) => (b.rating || 4.5) - (a.rating || 4.5));
  }

  const grid = document.getElementById("product-grid");
  const caption = document.getElementById("product-count-caption");
  if (caption) {
    caption.textContent = language === "hi"
      ? `${filtered.length} सामान हवेली खरगपुर में उपलब्ध`
      : `${filtered.length} products available in Haveli Kharagpur`;
  }

  if (!filtered.length) {
    const hi = language === "hi";
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h2>${hi ? "आपकी खोज से कोई सामान नहीं मिला" : "No items match your search"}</h2>
        <p>${hi ? 'दूध, आटा, टमाटर खोजें या कोई अन्य श्रेणी देखें।' : 'Try searching for "milk", "atta", "tomato", or explore another category.'}</p>
        <button class="primary-button" type="button" data-action="clear-filters">${hi ? "सभी सामान देखें" : "Show all items"}</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(p => productCard(p, false)).join("");
}

function formatUnit(unit, lang) {
  if (!unit) return "";
  if (lang !== "hi") return unit;
  return unit
    .replace(/\bpiece\b/gi, "पीस")
    .replace(/\bpieces\b/gi, "पीस")
    .replace(/\bpack\b/gi, "पैक")
    .replace(/\bkg\b/gi, "किग्रा")
    .replace(/\bg\b/gi, "ग्राम")
    .replace(/\blitre\b/gi, "लीटर")
    .replace(/\bdozen\b/gi, "दर्जन")
    .replace(/\bbottle\b/gi, "बोतल");
}

function productCard(p, isMini = false) {
  const qty = cart[p.id]?.qty || 0;
  const hi = language === "hi";
  const name = hi && p.nameHi ? p.nameHi : p.name;
  const subName = hi ? p.name : (p.nameHi || "");
  const out = p.inStock === false;
  const mrp = Number(p.mrp) || Number(p.price);
  const discountPercent = mrp > p.price ? Math.round(((mrp - p.price) / mrp) * 100) : 0;
  const rating = p.rating || 4.8;
  const etaText = hi ? "⚡ 10 मिनट" : "⚡ 10 MINS";
  const discountText = hi ? `${discountPercent}% छूट` : `${discountPercent}% OFF`;
  const unitText = formatUnit(p.unit, language);

  return `
    <article class="product-card ${out ? "out" : ""} ${isMini ? "product-card-mini" : ""}" data-id="${escapeHTML(p.id)}">
      <div class="product-badge-wrap">
        <span class="product-eta-pill">${etaText}</span>
        ${discountPercent > 0 ? `<span class="product-discount-pill">${discountText}</span>` : ""}
      </div>
      
      <div class="product-img-box" data-action="quick-view" data-id="${escapeHTML(p.id)}">
        <img class="product-image" src="${escapeHTML(p.image || fallbackImage(name))}" data-fallback="${escapeHTML(fallbackImage(name))}" alt="${escapeHTML(name)}" loading="lazy">
      </div>

      <div class="product-info">
        <div class="product-unit-row">
          <span class="product-unit">${escapeHTML(unitText || (hi ? "पीस" : "piece"))}</span>
          <span class="product-rating">★ ${rating}</span>
        </div>
        <h3 class="product-name" data-action="quick-view" data-id="${escapeHTML(p.id)}">${escapeHTML(name)}</h3>
        ${subName ? `<small class="product-subname">${escapeHTML(subName)}</small>` : ""}
        
        <div class="product-bottom">
          <div class="price-container">
            <strong class="price">${inr(p.price)}</strong>
            ${mrp > p.price ? `<span class="mrp">${inr(mrp)}</span>` : ""}
          </div>

          <div class="product-cta-wrap">
            ${out ? `
              <button class="add-button out-btn" type="button" disabled>${hi ? "स्टॉक समाप्त" : "Out of Stock"}</button>
            ` : (qty ? `
              <div class="stepper">
                <button type="button" data-action="minus" data-id="${escapeHTML(p.id)}" aria-label="${hi ? "मात्रा घटाएं" : "Decrease quantity"}">−</button>
                <span class="stepper-count">${qty}</span>
                <button type="button" data-action="plus" data-id="${escapeHTML(p.id)}" aria-label="${hi ? "मात्रा बढ़ाएं" : "Increase quantity"}>+</button>
              </div>
            ` : `
              <button class="add-button" type="button" data-action="plus" data-id="${escapeHTML(p.id)}">
                <span>${hi ? "जोड़ें" : "ADD"}</span>
              </button>
            `)}
          </div>
        </div>
      </div>
    </article>
  `;
}

// -------------------------------------------------------------
// CART MANAGEMENT
// -------------------------------------------------------------
function addItem(id, delta) {
  const product = products.find(p => p.id === id);
  if (!product || product.inStock === false) return;
  const current = cart[id] || {
    id,
    name: product.name,
    nameHi: product.nameHi,
    price: Number(product.price),
    mrp: Number(product.mrp) || Number(product.price),
    unit: product.unit,
    image: product.image,
    shopId: product.shopId,
    qty: 0
  };
  current.qty += delta;
  if (current.qty <= 0) {
    delete cart[id];
  } else {
    cart[id] = current;
  }
  saveCart(cart);
  renderProducts();
  renderFlashDeals();
  renderCuratedShelves();
  renderCart();
  if (currentModalProduct && currentModalProduct.id === id) {
    updateModalAction(id);
  }
}

function renderCart() {
  const count = cartCount(cart);
  const subtotal = cartSubtotal(cart);
  const mrpTotal = cartMrpTotal(cart);
  const baseSavings = cartSavings(cart);
  const hi = language === "hi";

  // 1. Sticky Cart Bar
  const stickyCart = document.getElementById("sticky-cart");
  const isHomeVisible = !document.getElementById("home-view").hidden;
  stickyCart.hidden = count === 0 || !isHomeVisible;

  document.getElementById("sticky-count").textContent = hi ? `${count} सामान` : `${count} item${count === 1 ? "" : "s"}`;
  document.getElementById("sticky-details").textContent = hi ? `${inr(subtotal)} · कार्ट देखें` : `${inr(subtotal)} · View Cart`;
  document.getElementById("sticky-total").textContent = inr(subtotal);
  const stickyArrow = stickyCart?.querySelector(".sticky-arrow");
  if (stickyArrow) {
    stickyArrow.textContent = hi ? "कार्ट देखें →" : "View Cart →";
  }

  // Bottom Nav badge
  const badge = document.getElementById("nav-cart-badge");
  if (badge) {
    badge.textContent = count;
    badge.hidden = count === 0;
  }

  // Thumbnails in sticky cart
  const thumbsContainer = document.getElementById("sticky-thumbnails");
  if (thumbsContainer) {
    const items = Object.values(cart).slice(0, 3);
    thumbsContainer.innerHTML = items.map(i => `
      <img class="mini-cart-thumb" src="${escapeHTML(i.image || fallbackImage(i.name))}" data-fallback="${escapeHTML(fallbackImage(i.name))}" alt="">
    `).join("");
  }

  // 2. Free Delivery Progress Bar
  const freeThreshold = Number(settings.freeDeliveryAbove ?? 299);
  const freeBar = document.getElementById("free-delivery-bar");
  const freeText = document.getElementById("free-delivery-text");
  if (freeBar && freeText) {
    if (subtotal >= freeThreshold) {
      freeBar.style.width = "100%";
      freeBar.classList.add("completed");
      freeText.innerHTML = hi ? "🎉 आपको मिली <strong>मुफ़्त डिलीवरी!</strong>" : "🎉 You unlocked <strong>FREE Delivery!</strong>";
    } else {
      const diff = freeThreshold - subtotal;
      const pct = Math.min(100, Math.round((subtotal / freeThreshold) * 100));
      freeBar.style.width = `${pct}%`;
      freeBar.classList.remove("completed");
      freeText.innerHTML = hi
        ? `<strong>मुफ़्त डिलीवरी</strong> पाने के लिए <strong>${inr(diff)}</strong> और जोड़ें`
        : `Add <strong>${inr(diff)}</strong> more to get <strong>FREE Delivery</strong>`;
    }
  }

  // 3. Cart Items List
  const itemsContainer = document.getElementById("cart-items");
  if (itemsContainer) {
    if (!count) {
      itemsContainer.innerHTML = `
        <div class="empty-state cart-empty">
          <div class="empty-icon">🛒</div>
          <h2>${hi ? "आपकी टोकरी खाली है" : "Your cart is empty"}</h2>
          <p>${hi ? "10 मिनट में डिलीवरी के लिए ताज़ा फल, सब्ज़ियां, दूध और ज़रूरी सामान जोड़ें!" : "Add fresh fruits, veggies, milk and daily essentials delivered in 10 minutes!"}</p>
          <button class="primary-button" type="button" data-view="home">${hi ? "खरीदारी शुरू करें" : "Start Shopping"}</button>
        </div>
      `;
    } else {
      itemsContainer.innerHTML = Object.values(cart).map(item => {
        const itemName = hi && item.nameHi ? item.nameHi : item.name;
        const itemUnit = formatUnit(item.unit, language);
        return `
          <div class="cart-row">
            <img src="${escapeHTML(item.image || fallbackImage(item.name))}" data-fallback="${escapeHTML(fallbackImage(item.name))}" alt="${escapeHTML(itemName)}" loading="lazy">
            <div class="cart-row-main">
              <strong>${escapeHTML(itemName)}</strong>
              <small>${escapeHTML(itemUnit)} · ${inr(item.price)} ${item.mrp > item.price ? `<span class="cart-mrp-strike">${inr(item.mrp)}</span>` : ""}</small>
            </div>
            <div class="cart-row-right">
              <div class="stepper">
                <button type="button" data-action="cart-minus" data-id="${escapeHTML(item.id)}" aria-label="${hi ? "मात्रा घटाएं" : "Decrease quantity"}">−</button>
                <span class="stepper-count">${item.qty}</span>
                <button type="button" data-action="cart-plus" data-id="${escapeHTML(item.id)}" aria-label="${hi ? "मात्रा बढ़ाएं" : "Increase quantity"}>+</button>
              </div>
              <strong class="cart-row-price">${inr(item.price * item.qty)}</strong>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // 4. Upsell Rail ("Missed something?")
  renderUpsellRail();

  // 5. Bill Calculations
  let deliveryFee = subtotal >= freeThreshold || subtotal === 0 ? 0 : Number(settings.deliveryFee || 15);
  const urgentSlot = document.querySelector('input[name="slot"]:checked')?.value === "Urgent 30 min";
  if (urgentSlot && subtotal > 0) {
    deliveryFee += Number(settings.urgentFee || 20);
  }

  const platformFee = count > 0 ? 2 : 0;
  const tipAmount = count > 0 ? Number(selectedTip || 0) : 0;

  // Coupon Discount
  let couponDiscount = 0;
  if (appliedCoupon && count > 0) {
    if (appliedCoupon.type === "percent") {
      couponDiscount = Math.round((subtotal * Number(appliedCoupon.value)) / 100);
      if (appliedCoupon.maxDiscount) couponDiscount = Math.min(couponDiscount, appliedCoupon.maxDiscount);
    } else if (appliedCoupon.type === "delivery") {
      couponDiscount = Math.min(deliveryFee, Number(appliedCoupon.value));
    } else {
      couponDiscount = Number(appliedCoupon.value);
    }
    couponDiscount = Math.min(couponDiscount, subtotal);
  }

  const grandTotal = Math.max(0, subtotal - couponDiscount + deliveryFee + platformFee + tipAmount);
  const totalSavings = baseSavings + couponDiscount + (subtotal >= freeThreshold ? Number(settings.deliveryFee || 15) : 0);

  // Update Bill Details Card
  document.getElementById("bill-mrp-total").textContent = inr(mrpTotal);
  document.getElementById("bill-savings-total").textContent = `-${inr(baseSavings)}`;
  document.getElementById("cart-subtotal").textContent = inr(subtotal);
  document.getElementById("cart-delivery").textContent = deliveryFee === 0 ? (hi ? "मुफ़्त" : "FREE") : inr(deliveryFee);
  document.getElementById("cart-delivery").classList.toggle("green-text", deliveryFee === 0);
  document.getElementById("bill-tip-display").textContent = inr(tipAmount);

  const discountRow = document.getElementById("discount-row");
  if (discountRow) {
    discountRow.hidden = couponDiscount === 0;
    document.getElementById("cart-discount").textContent = `-${inr(couponDiscount)}`;
    document.getElementById("cart-discount").dataset.value = String(couponDiscount);
  }

  document.getElementById("cart-total").textContent = inr(grandTotal);
  const checkoutBtnTotal = document.getElementById("checkout-btn-total");
  if (checkoutBtnTotal) checkoutBtnTotal.textContent = inr(grandTotal);
  const checkoutGrandTotal = document.getElementById("checkout-grand-total");
  if (checkoutGrandTotal) checkoutGrandTotal.textContent = inr(grandTotal);

  // Savings Badge
  const savingsCard = document.getElementById("savings-badge-card");
  const savingsNumber = document.getElementById("total-savings-number");
  if (savingsCard && savingsNumber) {
    savingsNumber.textContent = inr(totalSavings);
    savingsCard.hidden = totalSavings <= 0 || count === 0;
  }

  // Minimum order validation & CTA states
  const medicineOnly = Object.values(cart).every(item => products.find(p => p.id === item.id)?.category === "Medicine");
  const minOrder = medicineOnly ? 0 : Number(settings.minOrder ?? 50);

  const checkoutBtn = document.getElementById("checkout-button");
  if (checkoutBtn) {
    checkoutBtn.disabled = !count || subtotal < minOrder;
    if (subtotal < minOrder && count > 0) {
      checkoutBtn.innerHTML = `<span>${hi ? `चेकआउट के लिए ${inr(minOrder - subtotal)} और जोड़ें` : `Add ${inr(minOrder - subtotal)} more to checkout`}</span>`;
    } else {
      checkoutBtn.innerHTML = `<span>${hi ? "चेकआउट पर जाएं" : "Proceed to Checkout"}</span><span>${inr(grandTotal)} ›</span>`;
    }
  }

  const placeBtn = document.getElementById("place-order");
  if (placeBtn) {
    placeBtn.disabled = !count || subtotal < minOrder;
    if (subtotal < minOrder && count > 0) {
      placeBtn.textContent = hi ? `ऑर्डर के लिए ${inr(minOrder - subtotal)} और जोड़ें` : `Add ${inr(minOrder - subtotal)} more to order`;
    } else {
      placeBtn.textContent = hi ? `${inr(grandTotal)} का भुगतान करके ऑर्डर करें` : `Pay ${inr(grandTotal)} & Place Order`;
    }
  }

  // Repeat Order Banner on Home view
  const last = JSON.parse(localStorage.getItem("hk_last_order") || "null");
  const repeatBtn = document.getElementById("repeat-order");
  if (repeatBtn) {
    repeatBtn.hidden = !last?.items?.length;
    if (last?.items?.length) {
      const countItems = last.items.length;
      document.getElementById("repeat-subtitle").textContent = hi
        ? `पिछली डिलीवरी से ${countItems} सामान फिर से जोड़ें`
        : `${countItems} item${countItems > 1 ? "s" : ""} from your previous delivery`;
    }
  }
}

function renderUpsellRail() {
  const rail = document.getElementById("cart-upsell-rail");
  if (!rail) return;
  // Recommend staples like Bread, Chips, Coke, Butter, Samosa not yet in cart
  const cartIds = new Set(Object.keys(cart));
  const suggestions = products.filter(p => !cartIds.has(p.id)).slice(0, 8);
  const hi = language === "hi";
  rail.innerHTML = suggestions.map(p => {
    const name = hi && p.nameHi ? p.nameHi : p.name;
    const unit = formatUnit(p.unit, language);
    return `
      <div class="upsell-card">
        <img src="${escapeHTML(p.image || fallbackImage(p.name))}" data-fallback="${escapeHTML(fallbackImage(p.name))}" alt="${escapeHTML(name)}">
        <strong>${escapeHTML(name)}</strong>
        <small>${escapeHTML(unit)}</small>
        <div class="upsell-bottom">
          <span>${inr(p.price)}</span>
          <button type="button" class="upsell-add-btn" data-action="plus" data-id="${escapeHTML(p.id)}">${hi ? "+ जोड़ें" : "+ ADD"}</button>
        </div>
      </div>
    `;
  }).join("");
}

// -------------------------------------------------------------
// NAVIGATION & VIEWS
// -------------------------------------------------------------
function showView(view) {
  ["home", "cart", "checkout", "success", "orders"].forEach(name => {
    const el = document.getElementById(`${name}-view`);
    if (el) el.hidden = name !== view;
  });

  document.querySelectorAll(".bottom-nav button").forEach(b => {
    b.classList.toggle("nav-active", b.dataset.view === view);
  });

  if (view === "cart" || view === "checkout" || view === "success") {
    document.getElementById("sticky-cart").hidden = true;
  }
  if (view === "home") renderCart();
  if (view === "orders") renderLiveOrder();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearFilters() {
  category = "All";
  document.getElementById("search-input").value = "";
  const clearBtn = document.getElementById("clear-search-btn");
  if (clearBtn) clearBtn.hidden = true;
  renderCategories();
  renderProducts();
}

function showCategoriesOnly() {
  showView("home");
  document.getElementById("home-view").classList.add("categories-only");
  document.getElementById("category-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showFullHome() {
  document.getElementById("home-view").classList.remove("categories-only");
}

function showHeroSlide(index) {
  const slides = document.querySelectorAll(".hero-slide");
  const dots = document.querySelectorAll(".hero-dots button");
  if (!slides.length) return;
  const next = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => slide.classList.toggle("active", i === next));
  dots.forEach((dot, i) => dot.classList.toggle("active", i === next));
}

// -------------------------------------------------------------
// TOAST NOTIFICATIONS
// -------------------------------------------------------------
function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = typeof t === "function" ? t(message) : message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

// -------------------------------------------------------------
// PRODUCT QUICK-VIEW MODAL
// -------------------------------------------------------------
function openProductModal(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  currentModalProduct = p;

  const hi = language === "hi";
  const modal = document.getElementById("product-modal");
  const img = document.getElementById("modal-product-img");
  img.src = p.image || fallbackImage(p.name);
  img.dataset.fallback = fallbackImage(p.name);

  document.getElementById("modal-product-name").textContent = hi && p.nameHi ? p.nameHi : p.name;
  document.getElementById("modal-product-name-hi").textContent = hi ? p.name : (p.nameHi || "");
  document.getElementById("modal-product-unit").textContent = formatUnit(p.unit, language) || (hi ? "1 पैक" : "1 pack");
  document.getElementById("modal-product-rating").textContent = p.rating || "4.8";
  document.getElementById("modal-product-reviews").textContent = hi
    ? `(${p.ratingCount || 120} सत्यापित समीक्षाएं)`
    : `(${p.ratingCount || 120} verified reviews)`;

  const shop = shops.find(s => s.id === p.shopId);
  const shopName = shop?.name || (hi ? "खरगपुर लोकल मंडी" : "Kharagpur Local Mandi");
  document.getElementById("modal-product-shop").textContent = hi
    ? `${shopName} से सीधे प्राप्त`
    : `Sourced from ${shopName}`;

  const mrp = Number(p.mrp) || Number(p.price);
  const discount = mrp > p.price ? Math.round(((mrp - p.price) / mrp) * 100) : 0;
  document.getElementById("modal-product-price").textContent = inr(p.price);
  document.getElementById("modal-product-mrp").textContent = mrp > p.price ? inr(mrp) : "";
  const discPill = document.getElementById("modal-product-discount");
  discPill.textContent = hi ? `${discount}% छूट` : `${discount}% OFF`;
  discPill.hidden = discount <= 0;

  document.getElementById("modal-product-desc").textContent = p.description || (hi
    ? "ताज़ा और स्वच्छ सामान, आपके लिए सावधानी से छांटा और पैक किया गया।"
    : "Farm fresh and hygienic product carefully selected and packed for you.");

  updateModalAction(p.id);
  modal.hidden = false;
}

function updateModalAction(productId) {
  const wrap = document.getElementById("modal-action-wrap");
  if (!wrap) return;
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const qty = cart[productId]?.qty || 0;
  const hi = language === "hi";

  if (p.inStock === false) {
    wrap.innerHTML = `<button class="primary-button" disabled style="background:#9ca3af">${hi ? "स्टॉक समाप्त" : "Sold Out"}</button>`;
  } else if (qty > 0) {
    wrap.innerHTML = `
      <div class="stepper modal-stepper">
        <button type="button" data-action="minus" data-id="${escapeHTML(p.id)}" aria-label="${hi ? "मात्रा घटाएं" : "Decrease quantity"}">−</button>
        <span class="stepper-count">${qty} ${hi ? "टोकरी में" : "in basket"}</span>
        <button type="button" data-action="plus" data-id="${escapeHTML(p.id)}" aria-label="${hi ? "मात्रा बढ़ाएं" : "Increase quantity"}>+</button>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <button class="primary-button modal-add-btn" type="button" data-action="plus" data-id="${escapeHTML(p.id)}">
        ${hi ? "टोकरी में जोड़ें" : "ADD TO BASKET"} · ${inr(p.price)}
      </button>
    `;
  }
}

// -------------------------------------------------------------
// WALLET MANAGEMENT
// -------------------------------------------------------------
function updateWalletDisplay() {
  const topEl = document.getElementById("wallet-balance-display");
  if (topEl) topEl.textContent = inr(walletBalance);
  const drawerEl = document.getElementById("drawer-wallet-balance");
  if (drawerEl) drawerEl.textContent = inr(walletBalance);
  const checkoutEl = document.getElementById("checkout-wallet-bal");
  if (checkoutEl) checkoutEl.textContent = inr(walletBalance);
}

function addWalletBalance(amount) {
  walletBalance += Number(amount);
  localStorage.setItem("hk_wallet", String(walletBalance));
  updateWalletDisplay();
  toast(`₹${amount} added to your Kharagpur Fresh Wallet!`);
}

// -------------------------------------------------------------
// LOCATION & LOCALITY PICKER
// -------------------------------------------------------------
function updateLocationDisplay() {
  const textEl = document.getElementById("current-location-text");
  if (textEl) {
    const shortLoc = currentLocation.split(",")[0] || "Gandhi Chowk";
    textEl.textContent = `${shortLoc} ▾`;
  }
  const summaryEl = document.getElementById("cart-delivery-address-summary");
  if (summaryEl) {
    summaryEl.textContent = language === "hi"
      ? `डिलीवरी का पता: ${currentLocation}`
      : `Delivering to: ${currentLocation}`;
  }
}

function setLocation(loc) {
  currentLocation = loc;
  localStorage.setItem("hk_location", loc);
  updateLocationDisplay();
  document.getElementById("location-drawer").hidden = true;
  toast(`Delivering to ${loc.split(",")[0]}`);
}

// -------------------------------------------------------------
// RAZORPAY INTEGRATION & CHECKOUT
// -------------------------------------------------------------
async function initiateRazorpayPayment(order, grandTotal) {
  return new Promise((resolve, reject) => {
    function launch() {
      if (!window.Razorpay) {
        console.warn("Razorpay SDK not loaded, falling back to simulated dialog");
        openRazorpayMockModal(order, grandTotal, resolve, reject);
        return;
      }
      const options = {
        key: razorpayConfig.keyId,
        amount: Math.round(grandTotal * 100), // in paise
        currency: razorpayConfig.currency || "INR",
        name: razorpayConfig.companyName || "Kharagpur Fresh",
        description: `Order Payment for ${order.items.length} grocery items`,
        image: "./icon.svg",
        prefill: {
          name: order.customer.name,
          contact: order.customer.phone
        },
        theme: {
          color: razorpayConfig.themeColor || "#0c831f"
        },
        handler: function (response) {
          resolve({
            success: true,
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            signature: response.razorpay_signature
          });
        },
        modal: {
          ondismiss: function () {
            reject(new Error("Razorpay payment cancelled by user"));
          }
        }
      };
      try {
        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (response) {
          const reason = response.error?.description || response.error?.reason || "Payment failed";
          reject(new Error(reason));
        });
        rzp.open();
      } catch (err) {
        console.warn("Real Razorpay open failed, falling back to simulated dialog", err);
        openRazorpayMockModal(order, grandTotal, resolve, reject);
      }
    }

    // If user has supplied real Razorpay Key ID in firebase-config.js
    if (isRazorpayConfigured) {
      if (!window.Razorpay) {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => launch();
        script.onerror = () => {
          console.warn("Could not load checkout.js, falling back to mock modal");
          openRazorpayMockModal(order, grandTotal, resolve, reject);
        };
        document.head.appendChild(script);
      } else {
        launch();
      }
    } else {
      // Interactive Razorpay Mock Modal for local demo & testing
      openRazorpayMockModal(order, grandTotal, resolve, reject);
    }
  });
}

function openRazorpayMockModal(order, grandTotal, resolve, reject) {
  const modal = document.getElementById("razorpay-modal");
  document.getElementById("rzp-modal-amount").textContent = inr(grandTotal);
  document.getElementById("rzp-btn-amount").textContent = inr(grandTotal);
  modal.hidden = false;

  const confirmBtn = document.getElementById("rzp-pay-confirm");
  const onConfirm = () => {
    confirmBtn.removeEventListener("click", onConfirm);
    modal.hidden = true;
    resolve({
      success: true,
      paymentId: `rzp_mock_${Date.now()}`,
      method: document.querySelector('input[name="rzp-method"]:checked')?.value || "upi"
    });
  };
  confirmBtn.addEventListener("click", onConfirm, { once: true });

  const closeBtn = modal.querySelector("[data-close-modal]");
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.hidden = true;
      reject(new Error("Payment window closed"));
    };
  }
}

// -------------------------------------------------------------
// PLACE ORDER FLOW
// -------------------------------------------------------------
async function placeOrder(event) {
  event.preventDefault();
  if (placing) return;
  if (!cartCount(cart)) return toast("Your cart is empty");

  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const phone = String(data.get("phone")).replace(/\D/g, "");
  if (!/^[0-9]{10}$/.test(phone)) {
    toast("Please enter a valid 10-digit mobile number");
    return;
  }

  const items = Object.values(cart).map(i => ({
    id: i.id,
    name: i.name,
    qty: i.qty,
    price: i.price,
    mrp: i.mrp || i.price,
    unit: i.unit,
    shopId: i.shopId
  }));

  const subtotal = cartSubtotal(cart);
  const freeThreshold = Number(settings.freeDeliveryAbove ?? 299);
  let delivery = subtotal >= freeThreshold || subtotal === 0 ? 0 : Number(settings.deliveryFee || 15);
  if (data.get("slot") === "Urgent 30 min") {
    delivery += Number(settings.urgentFee || 20);
  }
  const platformFee = 2;
  const tip = Number(selectedTip || 0);
  const discount = Number(document.getElementById("cart-discount")?.dataset.value || 0);
  const grandTotal = Math.max(0, subtotal - discount + delivery + platformFee + tip);

  const paymentChoice = data.get("payment");

  // Check Wallet
  if (paymentChoice === "Kharagpur Fresh Wallet") {
    if (walletBalance < grandTotal) {
      toast(`Insufficient wallet balance (${inr(walletBalance)}). Please add money or choose Razorpay / COD.`);
      return;
    }
  }

  placing = true;
  const submit = document.getElementById("place-order");
  submit.disabled = true;
  submit.textContent = "Processing payment...";

  let razorpayResult = null;
  if (paymentChoice === "Razorpay Online") {
    try {
      razorpayResult = await initiateRazorpayPayment(
        { customer: { name: data.get("name"), phone }, items },
        grandTotal
      );
    } catch (err) {
      toast(err.message || "Payment cancelled");
      placing = false;
      submit.disabled = false;
      submit.textContent = `Pay ${inr(grandTotal)} & Place Order`;
      return;
    }
  } else if (paymentChoice === "Kharagpur Fresh Wallet") {
    walletBalance -= grandTotal;
    localStorage.setItem("hk_wallet", String(walletBalance));
    updateWalletDisplay();
  }

  const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
  const orderId = `HK${Date.now().toString().slice(-7)}`;

  const order = {
    id: orderId,
    customer: {
      name: String(data.get("name")).trim(),
      phone,
      address: String(data.get("address")).trim(),
      landmark: String(data.get("landmark")).trim(),
      area: String(data.get("area"))
    },
    items,
    subtotal,
    deliveryFee: delivery,
    platformFee,
    tip,
    discount,
    grandTotal,
    payment: paymentChoice,
    paymentId: razorpayResult?.paymentId || (paymentChoice === "Kharagpur Fresh Wallet" ? "wallet_pay" : "cod"),
    razorpayOrderId: razorpayResult?.orderId || null,
    razorpaySignature: razorpayResult?.signature || null,
    slot: data.get("slot"),
    instructions: Array.from(selectedInstructions),
    deliveryOtp,
    status: "New",
    createdAt: new Date().toISOString(),
    cancelledWithin2Min: false,
    cashCollected: paymentChoice === "Cash on Delivery" ? false : true,
    assignedAgentId: null
  };

  if (db) {
    try {
      const f = window.hkFirebase;
      const ref = await f.addDoc(f.collection(db, "orders"), {
        ...order,
        createdAt: f.serverTimestamp()
      });
      order.id = ref.id;
      updateLedger(order.id, order);
    } catch (error) {
      console.warn("Could not save to Firestore; order recorded locally", error);
    }
  }

  // Local persistence
  localStorage.setItem("hk_customer", JSON.stringify(order.customer));
  localStorage.setItem("hk_active_order", JSON.stringify(order));
  localStorage.setItem("hk_last_order", JSON.stringify({ items }));

  // Append to past orders history
  try {
    const existingHistory = JSON.parse(localStorage.getItem("hk_past_orders") || "[]");
    existingHistory.unshift(order);
    localStorage.setItem("hk_past_orders", JSON.stringify(existingHistory.slice(0, 25)));
  } catch {}

  activeOrderId = order.id;
  showSuccess(order.id, order);
  openWhatsApp(order.id, order);

  // Clear cart
  cart = {};
  saveCart(cart);
  renderCart();

  placing = false;
  submit.disabled = false;
  submit.textContent = `Pay ${inr(grandTotal)} & Place Order`;
}

async function updateLedger(orderId, order) {
  if (!db) return;
  const f = window.hkFirebase;
  for (const shopId of [...new Set(order.items.map(i => i.shopId).filter(Boolean))]) {
    const shopItems = order.items.filter(i => i.shopId === shopId);
    const itemsTotal = shopItems.reduce((sum, i) => sum + Number(i.price) * Number(i.qty), 0);
    const shop = shops.find(s => s.id === shopId);
    const percent = Number(shop?.commissionPercent || 5);
    await f.addDoc(f.collection(db, "ledger"), {
      orderId,
      shopId,
      itemsTotal,
      commissionPercent: percent,
      commissionAmount: (itemsTotal * percent) / 100,
      deliveryFee: order.deliveryFee,
      riderCost: 0,
      netEarning: itemsTotal - (itemsTotal * percent) / 100,
      shopPaid: false,
      createdAt: f.serverTimestamp()
    });
  }
}

// -------------------------------------------------------------
// SUCCESS VIEW & LIVE ORDER TRACKING
// -------------------------------------------------------------
function showSuccess(orderId, orderData = null) {
  showView("success");
  document.getElementById("order-id-text").textContent = `Order ID: ${orderId}`;
  document.getElementById("cancel-window-box").hidden = false;

  const order = orderData || JSON.parse(localStorage.getItem("hk_active_order") || "null");
  if (order?.deliveryOtp) {
    document.getElementById("live-order-otp").textContent = order.deliveryOtp;
  }

  // Trigger celebration confetti
  launchConfetti();

  // 2-minute cancellation countdown timer
  clearTimeout(cancelTimerId);
  cancelTimerId = setTimeout(() => {
    const cancelBox = document.getElementById("cancel-window-box");
    if (cancelBox) cancelBox.hidden = true;
  }, 120000);

  // Firestore realtime order listener
  if (db) {
    const f = window.hkFirebase;
    unsubOrder?.();
    unsubOrder = f.onSnapshot(f.doc(db, "orders", orderId), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      const status = data.status || "New";
      updateLiveTrackerUI(status);
      document.getElementById("live-status").textContent = getStatusMessage(status);
      document.getElementById("cancel-order").hidden = !(status === "New" && Date.now() - toMillis(data.createdAt) < 120000);
      document.getElementById("rating-box").hidden = status !== "Delivered";
    });
  } else {
    // Simulated progression for local demo
    const hi = language === "hi";
    updateLiveTrackerUI("Preparing");
    document.getElementById("live-status").textContent = hi
      ? "पार्टनर राजू कुमार खरगपुर स्टेपल्स पर आपका ऑर्डर पैक कर रहे हैं"
      : "Partner Raju Kumar is packing your order at Kharagpur Staples";
    setTimeout(() => {
      updateLiveTrackerUI("Out for delivery");
      document.getElementById("live-status").textContent = hi
        ? "राजू कुमार रास्ते में हैं (लगभग ~8 मिनट में आगमन) 🛵"
        : "Raju Kumar is on the way (Arriving in ~8 mins) 🛵";
    }, 15000);
  }
}

function updateLiveTrackerUI(status) {
  const packingStep = document.getElementById("step-packing");
  const deliveryStep = document.getElementById("step-delivery");
  const deliveredStep = document.getElementById("step-delivered");
  const lineRider = document.getElementById("line-rider");
  const lineDone = document.getElementById("line-done");

  packingStep.className = "step-item";
  deliveryStep.className = "step-item";
  deliveredStep.className = "step-item";
  lineRider.className = "step-line";
  lineDone.className = "step-line";

  if (status === "New" || status === "Accepted" || status === "Preparing") {
    packingStep.className = "step-item step-current";
  } else if (status === "Ready" || status === "Assigned" || status === "Picked Up" || status === "Out for delivery" || status === "Out for Delivery") {
    packingStep.className = "step-item step-done";
    lineRider.className = "step-line active";
    deliveryStep.className = "step-item step-current";
  } else if (status === "Delivered") {
    packingStep.className = "step-item step-done";
    lineRider.className = "step-line active";
    deliveryStep.className = "step-item step-done";
    lineDone.className = "step-line active";
    deliveredStep.className = "step-item step-done";
  }
}

function getStatusMessage(status) {
  const hi = language === "hi";
  switch (status) {
    case "New": return hi ? "ऑर्डर दर्ज हुआ और स्टोर को भेजा गया" : "Order placed & sent to Kharagpur store";
    case "Accepted": return hi ? "स्टोर ने ऑर्डर स्वीकार कर लिया" : "Store accepted your order";
    case "Preparing": return hi ? "पार्टनर आपका सामान सावधानी से पैक कर रहे हैं" : "Partner is packing your items with care";
    case "Ready": return hi ? "ऑर्डर तैयार है और जल्द निकलेगा" : "Order packed & ready for pickup";
    case "Assigned":
    case "Picked Up":
    case "Out for delivery":
    case "Out for Delivery":
      return hi ? "डिलीवरी के लिए निकला · पार्टनर राजू कुमार रास्ते में हैं 🛵" : "Out for delivery · Partner Raju Kumar is on the way";
    case "Delivered": return hi ? "डिलीवर हो गया! खरगपुर फ्रेश चुनने के लिए धन्यवाद 🎉" : "Delivered! Thank you for ordering from Kharagpur Fresh 🎉";
    case "Cancelled": return hi ? "ऑर्डर रद्द कर दिया गया" : "Order was cancelled";
    default: return status;
  }
}

function toMillis(value) {
  return value?.toMillis ? value.toMillis() : new Date(value || Date.now()).getTime();
}

const activeStatuses = new Set(["New", "Accepted", "Preparing", "Ready", "Assigned", "Picked Up", "Out for delivery", "Out for Delivery"]);

function renderLiveOrder(orderOverride = null) {
  const section = document.getElementById("live-order-section");
  const card = document.getElementById("live-order-card");
  const order = orderOverride || JSON.parse(localStorage.getItem("hk_active_order") || "null");
  if (!order || !activeStatuses.has(order.status || "New")) {
    section.hidden = true;
    card.innerHTML = "";
    return;
  }
  section.hidden = false;
  card.innerHTML = orderCard(order.id, order, true);
}

function openWhatsApp(orderId, order) {
  const phone = (settings.storeWhatsApp || "919876543210").replace(/\D/g, "");
  const summary = `*New Grocery Order ${orderId}*\nCustomer: ${order.customer.name}\nPhone: ${order.customer.phone}\nAddress: ${order.customer.address}, ${order.customer.area}\nLandmark: ${order.customer.landmark || "-"}\nSlot: ${order.slot}\nPayment: ${order.payment} (${order.paymentId || "pending"})\nOTP: ${order.deliveryOtp}\n\n*Items:*\n${order.items.map(i => `• ${i.qty}x ${i.name} - ${inr(i.price * i.qty)}`).join("\n")}\n\nSubtotal: ${inr(order.subtotal)}\nDelivery: ${inr(order.deliveryFee)}\nTip: ${inr(order.tip || 0)}\n*Grand Total: ${inr(order.grandTotal)}*`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(summary)}`, "_blank", "noopener");
}

async function findOrders(phone) {
  const list = document.getElementById("orders-list");
  const hi = language === "hi";
  list.innerHTML = `<p>${hi ? "ऑर्डर खोजे जा रहे हैं..." : "Finding orders..."}</p>`;

  // Check local past orders first
  const localOrders = JSON.parse(localStorage.getItem("hk_past_orders") || "[]").filter(o => o.customer?.phone === phone);

  if (!db) {
    renderLiveOrder();
    if (localOrders.length) {
      list.innerHTML = localOrders.map(o => orderCard(o.id, o)).join("");
    } else {
      list.innerHTML = `<p class="empty-orders-text">${hi ? `फ़ोन ${phone} के लिए कोई पिछला ऑर्डर नहीं मिला।` : `No past orders found for ${phone}. Orders will be saved here automatically.`}</p>`;
    }
    return;
  }

  const f = window.hkFirebase;
  try {
    const snap = await f.getDocs(f.query(f.collection(db, "orders"), f.where("customer.phone", "==", phone)));
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    const active = records.find(order => activeStatuses.has(order.status || "New"));
    renderLiveOrder(active || null);
    const history = records.filter(order => order.id !== active?.id);
    list.innerHTML = history.length ? history.map(order => orderCard(order.id, order)).join("") : `<p>${hi ? "कोई पिछला ऑर्डर नहीं मिला।" : "No past orders found in cloud database."}</p>`;
  } catch (error) {
    list.innerHTML = `<p>${escapeHTML(error.message)}</p>`;
  }
}

function orderCard(id, o, live = false) {
  const time = o.createdAt?.toMillis ? new Date(o.createdAt.toMillis()).toLocaleString("en-IN") : new Date(o.createdAt || Date.now()).toLocaleString("en-IN");
  const hi = language === "hi";
  const statusHi = {
    "New": "नया ऑर्डर",
    "Accepted": "स्वीकृत",
    "Preparing": "पैकिंग जारी",
    "Ready": "तैयार",
    "Assigned": "पार्टनर असाइन हुआ",
    "Picked Up": "पिकअप हुआ",
    "Out for delivery": "डिलीवरी के लिए निकला",
    "Out for Delivery": "डिलीवरी के लिए निकला",
    "Delivered": "डिलीवर हुआ",
    "Cancelled": "रद्द हुआ"
  }[o.status || "New"] || (o.status || "New");

  return `
    <article class="order-card ${live ? "live-order-card" : ""}">
      <div class="order-card-header">
        <div>
          <strong>${escapeHTML(id)}</strong>
          <small class="order-time-text">${escapeHTML(time)}</small>
        </div>
        <span class="status-pill status-${(o.status || "New").toLowerCase().replace(/\s+/g, "-")}">${escapeHTML(hi ? statusHi : (o.status || "New"))}</span>
      </div>

      <div class="order-items-snippet">
        ${(o.items || []).map(i => `${i.qty}x ${escapeHTML(hi && i.nameHi ? i.nameHi : i.name)}`).join(", ")}
      </div>

      <div class="order-card-footer">
        <strong class="order-total-pill">${inr(o.grandTotal)} · ${escapeHTML(o.payment || "COD")}</strong>
        <div class="order-card-actions">
          <button type="button" class="reorder-btn" data-reorder='${escapeHTML(JSON.stringify(o.items || []))}'>⚡ ${hi ? "फिर से ऑर्डर करें" : "Reorder"}</button>
          <button type="button" class="view-invoice-card-btn" data-invoice='${escapeHTML(JSON.stringify(o))}'>${hi ? "बिल देखें" : "Invoice"}</button>
        </div>
      </div>
    </article>
  `;
}

// -------------------------------------------------------------
// COUPONS
// -------------------------------------------------------------
function applyCoupon(codeOverride = null) {
  const code = (codeOverride || document.getElementById("coupon-code").value).trim().toUpperCase();
  const coupon = coupons.find(c => c.code?.toUpperCase() === code && c.active !== false);
  if (!coupon) return toast("Invalid coupon code");
  const subtotal = cartSubtotal(cart);
  if (subtotal < Number(coupon.minOrder || 0)) {
    return toast(`Minimum order value for ${code} is ${inr(coupon.minOrder || 0)}`);
  }
  appliedCoupon = coupon;
  document.getElementById("coupon-code").value = code;
  toast(`Coupon ${code} applied successfully! 🎉`);
  renderCart();
}

// -------------------------------------------------------------
// CANCEL ORDER & RATING
// -------------------------------------------------------------
async function cancelActiveOrder() {
  if (!activeOrderId) return;
  if (db) {
    const f = window.hkFirebase;
    try {
      await f.updateDoc(f.doc(db, "orders", activeOrderId), {
        status: "Cancelled",
        cancelledWithin2Min: true,
        cancelledAt: f.serverTimestamp()
      });
      toast("Order has been cancelled.");
    } catch {
      toast("Could not cancel order.");
    }
  } else {
    toast("Order cancelled.");
    const saved = JSON.parse(localStorage.getItem("hk_active_order") || "null");
    if (saved) {
      saved.status = "Cancelled";
      localStorage.setItem("hk_active_order", JSON.stringify(saved));
      renderLiveOrder();
    }
  }
  document.getElementById("cancel-window-box").hidden = true;
  document.getElementById("live-status").textContent = language === "hi" ? "ऑर्डर रद्द कर दिया गया" : "Order cancelled";
}

async function submitRating(rating) {
  if (!activeOrderId) return;
  if (db) {
    const f = window.hkFirebase;
    await f.addDoc(f.collection(db, "ratings"), {
      orderId: activeOrderId,
      rating,
      createdAt: f.serverTimestamp()
    });
  } else {
    localStorage.setItem(`hk_rating_${activeOrderId}`, String(rating));
  }
  document.querySelectorAll("#stars button").forEach(b => {
    b.classList.toggle("selected", Number(b.dataset.rating) <= rating);
  });
  toast("Thank you for rating your delivery! ⭐");
}

// -------------------------------------------------------------
// INVOICE POPUP GENERATOR
// -------------------------------------------------------------
function openInvoice(orderData = null) {
  const order = orderData || JSON.parse(localStorage.getItem("hk_active_order") || "null");
  if (!order) return toast("No order selected");

  const hi = language === "hi";
  document.getElementById("inv-order-id").textContent = order.id || "HK-Invoice";
  document.getElementById("inv-customer-name").textContent = order.customer?.name || (hi ? "सम्मानित ग्राहक" : "Valued Customer");
  document.getElementById("inv-customer-phone").textContent = order.customer?.phone || "-";
  document.getElementById("inv-customer-addr").textContent = `${order.customer?.address || ""}, ${order.customer?.area || ""}`;
  document.getElementById("inv-date-time").textContent = new Date(order.createdAt || Date.now()).toLocaleString("en-IN");

  const tableBody = document.getElementById("inv-items-table");
  tableBody.innerHTML = (order.items || []).map(i => {
    const itemName = hi && i.nameHi ? i.nameHi : i.name;
    return `
      <tr>
        <td>${escapeHTML(itemName)}</td>
        <td>${i.qty}</td>
        <td>${inr(i.price)}</td>
        <td>${inr(i.price * i.qty)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("inv-subtotal").textContent = inr(order.subtotal);
  document.getElementById("inv-delivery").textContent = inr(order.deliveryFee);
  document.getElementById("inv-discount").textContent = `-${inr(order.discount || 0)}`;
  document.getElementById("inv-total").textContent = inr(order.grandTotal);

  document.getElementById("invoice-modal").hidden = false;
}

// -------------------------------------------------------------
// CONFETTI CELEBRATION
// -------------------------------------------------------------
function launchConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.parentElement.clientWidth || 360;
  canvas.height = canvas.parentElement.clientHeight || 450;

  const particles = Array.from({ length: 70 }, () => ({
    x: canvas.width * 0.5,
    y: canvas.height * 0.2,
    vx: (Math.random() - 0.5) * 8,
    vy: (Math.random() - 0.7) * 9,
    size: Math.random() * 7 + 4,
    color: ["#16a34a", "#facc15", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899"][Math.floor(Math.random() * 6)],
    tilt: Math.random() * 10
  }));

  let frame = 0;
  function anim() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22; // gravity
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    frame++;
    if (frame < 90) requestAnimationFrame(anim);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(anim);
}

// -------------------------------------------------------------
// LANGUAGE & TRANSLATIONS (Bilingual English <-> Hindi Engine)
// -------------------------------------------------------------
const translations = {
  // Brand & Header
  "10 MINS DELIVERY": "10 मिनट में डिलीवरी",
  "⚡ 10 MINS": "⚡ 10 मिनट",
  "Switch Language": "भाषा बदलें",
  "Switch to Hindi": "हिंदी में बदलें",
  "Switch to English": "Switch to English",
  "Voice Search": "आवाज़ से खोजें",
  "Clear search": "खोज साफ़ करें",
  "Trending:": "लोकप्रिय खोज:",
  "🥛 Milk": "🥛 दूध",
  "🍅 Tomato": "🍅 टमाटर",
  "🌾 Atta": "🌾 आटा",
  "🍿 Chips": "🍿 चिप्स",
  "🧈 Amul Butter": "🧈 अमूल मक्खन",
  "🍜 Maggi": "🍜 मैगी",
  "🥚 Eggs": "🥚 अंडे",
  "🥟 Samosa": "🥟 समोसा",

  // Hero carousel
  "⚡ 10-MINUTE QUICK COMMERCE": "⚡ 10 मिनट की तेज़ डिलीवरी",
  "Fresh picks at": "ताज़ी चीज़ें",
  "mandi rates": "मंडी भाव पर",
  "Farm fresh veggies, dairy & daily groceries delivered under 10 minutes.": "ताज़ी सब्ज़ियां, डेयरी और रोज़मर्रा का सामान 10 मिनट में आपके घर तक।",
  "Shop Now →": "अभी खरीदें →",
  "CRAVINGS & SNACKS": "स्नैक्स और कोल्ड ड्रिंक्स",
  "Chilled drinks &": "ठंडे पेय और",
  "hot munchies": "गरम स्नैक्स",
  "Cold drinks, ice creams, chips & hot samosas delivered in 10 minutes.": "कोल्ड ड्रिंक, आइसक्रीम, चिप्स और समोसे सिर्फ 10 मिनट में।",
  "Explore Snacks →": "स्नैक्स देखें →",
  "KITCHEN SUPER SAVERS": "रसोई सुपर सेवर्स",
  "Stock up pantry": "पेंट्री भरें",
  "save up to 30%": "30% तक बचत करें",
  "Aashirvaad Atta, Basmati Rice, Dals & Cooking Oils at wholesale prices.": "आशीर्वाद आटा, बासमती चावल, दाल और कुकिंग ऑयल थोक भाव पर।",
  "Save Big →": "बड़ी बचत करें →",

  // Trust Strip
  "10-15 Min Delivery": "10-15 मिनट डिलीवरी",
  "100% Mandi Fresh": "100% मंडी ताज़ा",
  "Lowest Prices": "सबसे कम कीमत",
  "Razorpay & COD": "रेज़रपे और कैश ऑन डिलीवरी",

  // Repeat order
  "Repeat last order": "पिछला ऑर्डर दोहराएं",
  "Tap to re-add your favorite items to cart": "पसंदीदा सामान फिर से कार्ट में जोड़ने के लिए टैप करें",

  // Quick categories
  "Explore Categories": "श्रेणियां देखें",
  "See all ›": "सभी देखें ›",
  "Vegetables": "सब्ज़ियां",
  "Fresh Fruits": "ताज़े फल",
  "Dairy & Eggs": "डेयरी व अंडे",
  "Munchies": "नमकीन व स्नैक्स",
  "Atta & Dals": "आटा व दालें",
  "Ready Food": "तैयार खाना",
  "10-Min Pharma": "दवाईयां",
  "All Items": "सभी सामान",

  // Flash deals & Curated
  "⚡ SUPER SAVER": "⚡ सुपर सेवर",
  "Deal of the Day": "आज का धमाकेदार ऑफर",
  "Ends in": "समाप्त होने में",
  "🥛 Morning Essentials": "🥛 सुबह की ज़रूरतें",
  "Milk, Curd, Bread, Butter & Farm Fresh Eggs": "दूध, दही, ब्रेड, मक्खन और ताज़े अंडे",
  "View all": "सभी देखें",
  "🥬 Farm Fresh Vegetables & Fruits": "🥬 ताज़ी सब्ज़ियां और फल",
  "Direct from local mandis in Kharagpur": "खरगपुर की स्थानीय मंडियों से सीधे",

  // Main Section & Filters
  "Shop by Category": "श्रेणी के अनुसार खरीदें",
  "All categories ›": "सभी श्रेणियां ›",
  "Popular Items Near You": "आपके पास लोकप्रिय सामान",
  "Sort products": "सामान क्रमबद्ध करें",
  "Popularity": "लोकप्रियता",
  "Price: Low to High": "कीमत: कम से ज़्यादा",
  "Price: High to Low": "कीमत: ज़्यादा से कम",
  "Biggest Discount": "सबसे बड़ी छूट",
  "ADD": "जोड़ें",
  "Out of Stock": "स्टॉक समाप्त",
  "Sold Out": "स्टॉक समाप्त",

  // Footer & Trust
  "Superfast Delivery": "सुपरफास्ट डिलीवरी",
  "Orders packed with care and delivered in 10-15 minutes.": "ऑर्डर सावधानी से पैक करके 10-15 मिनट में डिलीवर किए जाते हैं।",
  "100% Quality Guaranteed": "100% गुणवत्ता की गारंटी",
  "Directly sourced from trusted local stores & farmers in Haveli Kharagpur.": "हवेली खरगपुर के स्थानीय स्टोर्स और किसानों से सीधे प्राप्त।",
  "Razorpay & Cash on Delivery": "रेज़रपे और कैश ऑन डिलीवरी",
  "Pay securely via UPI (GPay/PhonePe), Cards or Cash on Delivery.": "UPI (GPay/PhonePe), कार्ड या कैश ऑन डिलीवरी से सुरक्षित भुगतान करें।",
  "· Hyperlocal Quick Commerce": "· हाइपरलोकल क्विक कॉमर्स",
  "Helpline:": "हेल्पलाइन:",
  "Chat on WhatsApp": "WhatsApp पर चैट करें",

  // Cart View
  "Your Cart": "आपकी टोकरी",
  "Delivery in 10–15 minutes": "10–15 मिनट में डिलीवरी",
  "Freshly packed from nearby partner stores in Kharagpur": "खरगपुर के पार्टनर स्टोर्स से ताज़ा पैकिंग",
  "Add ₹140 more to get": "मुफ़्त डिलीवरी के लिए ₹140 और जोड़ें",
  "FREE Delivery": "मुफ़्त डिलीवरी",
  "Missed something?": "कुछ छूट गया?",
  "Popular additions": "लोकप्रिय सुझाव",
  "Delivery instructions": "डिलीवरी निर्देश",
  "🚪 Leave at door": "🚪 दरवाज़े पर छोड़ें",
  "🔕 Do not ring bell": "🔕 घंटी न बजाएं",
  "📞 Call upon arrival": "📞 पहुंचने पर कॉल करें",
  "🐕 Beware of pets": "🐕 पालतू जानवरों से सावधान",
  "Apply": "लागू करें",
  "Flat ₹50 OFF on ₹199+": "₹199+ पर फ्लैट ₹50 की छूट",
  "Free Delivery": "मुफ़्त डिलीवरी",
  "20% Extra Savings": "20% अतिरिक्त बचत",
  "Tip your delivery partner": "डिलीवरी पार्टनर को टिप दें",
  "100% of your tip goes to your partner Raju Kumar": "आपकी 100% टिप डिलीवरी पार्टनर राजू कुमार को जाती है",
  "None": "कोई नहीं",
  "Bill Details": "बिल विवरण",
  "Item total (MRP)": "सामान का कुल मूल्य (MRP)",
  "Product discount": "सामान पर छूट",
  "Item subtotal": "उप-योग (Subtotal)",
  "Delivery partner fee": "डिलीवरी पार्टनर शुल्क",
  "Platform & handling fee": "प्लेटफ़ॉर्म व हैंडलिंग शुल्क",
  "Delivery partner tip": "डिलीवरी पार्टनर टिप",
  "Coupon discount": "कूपन छूट",
  "Grand Total": "कुल भुगतान राशि",
  "🎉 You are saving": "🎉 आप बचत कर रहे हैं",
  "on this order!": "इस ऑर्डर पर!",
  "Cancellation Policy:": "रद्दीकरण नीति:",
  "Orders can be cancelled for free within 2 minutes of placing.": "ऑर्डर देने के 2 मिनट के भीतर मुफ़्त में रद्द किया जा सकता है।",
  "Proceed to Checkout": "चेकआउट पर जाएं",

  // Checkout View
  "Checkout & Payment": "चेकआउट और भुगतान",
  "📍 Delivery Address": "📍 डिलीवरी का पता",
  "Autofill": "सेव पता भरें",
  "Full Name *": "पूरा नाम *",
  "10-Digit Mobile Number *": "10 अंकों का मोबाइल नंबर *",
  "Complete Street Address / House No. *": "पूरा पता / मकान नंबर *",
  "Landmark": "लैंडमार्क (पहचान चिन्ह)",
  "Area / Locality *": "इलाका / मोहल्ला *",
  "Select Kharagpur Area": "खरगपुर इलाका चुनें",
  "Haveli Kharagpur Main Market": "हवेली खरगपुर मुख्य बाज़ार",
  "Gadighat Chowk": "गाड़ीघाट चौक",
  "Railway Colony": "रेलवे कॉलोनी",
  "Sunderpur": "सुंदरपुर",
  "Patel Nagar / Ward 1-5": "पटेल नगर / वार्ड 1-5",
  "College Road / Ward 6-10": "कॉलेज रोड / वार्ड 6-10",
  "Hospital Road / Ward 11-15": "अस्पताल रोड / वार्ड 11-15",
  "⚡ Select Delivery Slot": "⚡ डिलीवरी स्लॉट चुनें",
  "Delivery Slot": "डिलीवरी स्लॉट",
  "INSTANT": "तुरंत",
  "Instant 10-15 Mins": "तुरंत 10-15 मिनट",
  "Rider departs immediately": "राइडर तुरंत रवाना होगा",
  "Morning Slot": "सुबह का स्लॉट",
  "Evening Slot": "शाम का स्लॉट",
  "Night Slot": "रात का स्लॉट",
  "💳 Payment Method": "💳 भुगतान का तरीका",
  "Payment Options": "भुगतान विकल्प",
  "Pay Online with Razorpay": "रेज़रपे से ऑनलाइन भुगतान",
  "UPI (Google Pay, PhonePe, Paytm), Cards, NetBanking": "UPI (गूगल पे, फोनपे, पेटीएम), कार्ड, नेटबैंकिंग",
  "⚡ Fast &amp; 100% Secure": "⚡ तेज़ और 100% सुरक्षित",
  "⚡ Fast & 100% Secure": "⚡ तेज़ और 100% सुरक्षित",
  "Cash on Delivery (COD)": "कैश ऑन डिलीवरी (COD)",
  "Pay cash or scan QR when your order arrives": "डिलीवरी के समय नकद या QR कोड स्कैन करके भुगतान करें",
  "Kharagpur Fresh Wallet": "खरगपुर फ्रेश वॉलेट",
  "Available Balance:": "उपलब्ध बैलेंस:",
  "Total Payable": "कुल देय राशि",
  "Place Order &amp; Pay": "ऑर्डर करें और भुगतान करें",
  "Place Order & Pay": "ऑर्डर करें और भुगतान करें",

  // Success & Live Tracking
  "Order Placed Successfully!": "ऑर्डर सफलतापूर्वक दर्ज हो गया!",
  "⚡ Arriving at your doorstep in": "⚡ आपके दरवाज़े पर पहुंचेगा सिर्फ",
  "10–15 minutes": "10–15 मिनट में",
  "Confirmed": "पुष्टि हुई",
  "Packing": "पैकिंग जारी",
  "Out for Delivery": "डिलीवरी के लिए निकला",
  "Delivered": "डिलीवर हो गया",
  "🏬 Store": "🏬 स्टोर",
  "🏠 You": "🏠 आपका घर",
  "Preparing order at Kharagpur Staples": "खरगपुर स्टेपल्स पर ऑर्डर पैक हो रहा है",
  "🔐 Delivery OTP": "🔐 डिलीवरी OTP",
  "Share this 4-digit code with your delivery partner only after receiving items.": "यह 4 अंकों का कोड सामान मिलने के बाद ही डिलीवरी पार्टनर के साथ साझा करें।",
  "Delivery Partner · ⭐ 4.9 (140+ orders)": "डिलीवरी पार्टनर · ⭐ 4.9 (140+ ऑर्डर)",
  "Hero Electric · BR-08-E-4021": "हीरो इलेक्ट्रिक · BR-08-E-4021",
  "📞 Call": "📞 कॉल करें",
  "⏱️ Need to change something? Free cancellation within 2 mins.": "⏱️ कुछ बदलना चाहते हैं? 2 मिनट में मुफ़्त कैंसिलेशन।",
  "Cancel Order": "ऑर्डर रद्द करें",
  "📄 View &amp; Print Bill": "📄 बिल देखें और प्रिंट करें",
  "📄 View & Print Bill": "📄 बिल देखें और प्रिंट करें",
  "Order More Items": "और सामान ऑर्डर करें",
  "How was your delivery experience?": "डिलीवरी का अनुभव कैसा रहा?",
  "Rate partner Raju Kumar": "पार्टनर राजू कुमार को रेटिंग दें",

  // Orders View
  "My Orders": "मेरे ऑर्डर",
  "⚡ Live Order Tracking": "⚡ लाइव ऑर्डर ट्रैकिंग",
  "● In Progress": "● प्रगति पर है",
  "Order History": "ऑर्डर इतिहास",
  "Find Orders": "ऑर्डर खोजें",

  // Bottom Navigation & Sticky Cart
  "0 items": "0 सामान",
  "View Cart →": "कार्ट देखें →",
  "Home": "होम",
  "Categories": "श्रेणियां",
  "Search": "खोजें",
  "Orders": "ऑर्डर",
  "Cart": "कार्ट",

  // Location Drawer
  "📍 Select Delivery Location": "📍 डिलीवरी का पता चुनें",
  "Detect Current Location": "वर्तमान स्थान पहचानें",
  "Using GPS / Geolocation": "GPS / लोकेशन के ज़रिए",
  "Popular Kharagpur Localities": "खरगपुर के लोकप्रिय इलाके",
  "Gandhi Chowk (Main Market)": "गांधी चौक (मुख्य बाज़ार)",
  "Near River Bridge · 811202": "नदी पुल के पास · 811202",
  "Station Road · 811202": "स्टेशन रोड · 811202",
  "Munger Road · 811202": "मुंगेर रोड · 811202",
  "Patel Nagar (Ward 1-5)": "पटेल नगर (वार्ड 1-5)",
  "College Road (Ward 6-10)": "कॉलेज रोड (वार्ड 6-10)",
  "Near RS College": "आर.एस. कॉलेज के पास",
  "Hospital Road (Ward 11-15)": "अस्पताल रोड (वार्ड 11-15)",
  "Near Referral Hospital": "रेफरल अस्पताल के पास",

  // Product Modal
  "Product Details": "सामान का विवरण",
  "Detailed fresh grocery description.": "ताज़ी और शुद्ध किराने का विवरण।",
  "Sourced Fresh:": "ताज़ा प्राप्ति:",
  "Daily harvest": "दैनिक ताज़ा आवक",
  "Shelf Life:": "उपयोग अवधि:",
  "Check pack for expiry": "पैकेट पर एक्सपायरी देखें",
  "Return Policy:": "वापसी नीति:",
  "Instant doorstep replacement": "तुरंत दरवाज़े पर रिप्लेसमेंट",

  // Profile Drawer
  "Welcome to Kharagpur Fresh": "खरगपुर फ्रेश में आपका स्वागत है",
  "Instant Grocery Delivery": "10 मिनट में सुपरफास्ट डिलीवरी",
  "Quick Add Balance:": "वॉलेट में पैसे जोड़ें:",
  "📦 My Orders &amp; Tracking": "📦 मेरे ऑर्डर और ट्रैकिंग",
  "📦 My Orders & Tracking": "📦 मेरे ऑर्डर और ट्रैकिंग",
  "📍 Delivery Addresses": "📍 डिलीवरी का पता",
  "🌐 Language:": "🌐 भाषा:",
  "English": "English",
  "Switch": "बदलें",
  "💬 WhatsApp Help &amp; Support": "💬 व्हाट्सएप सहायता",
  "💬 WhatsApp Help & Support": "💬 व्हाट्सएप सहायता",
  "Open": "खोलें",
  "⚙️ Store Admin Portal": "⚙️ स्टोर एडमिन पोर्टल",
  "🛵 Delivery Agent Portal": "🛵 डिलीवरी एजेंट पोर्टल",

  // Razorpay Simulation Modal
  "Trusted by 5 Crore+ Indians": "5 करोड़+ भारतीयों का भरोसा",
  "Paying to Kharagpur Fresh": "खरगपुर फ्रेश को भुगतान",
  "Google Pay / PhonePe UPI": "गूगल पे / फोनपे UPI",
  "Instant UPI payment approval": "तुरंत UPI भुगतान मंज़ूरी",
  "Fast": "तेज़",
  "Credit / Debit Card": "क्रेडिट / डेबिट कार्ड",
  "Visa, Mastercard, RuPay": "वीज़ा, मास्टरकार्ड, रुपे",
  "Net Banking": "नेट बैंकिंग",
  "SBI, HDFC, ICICI, Axis &amp; 50+ Banks": "SBI, HDFC, ICICI, Axis और 50+ बैंक",
  "SBI, HDFC, ICICI, Axis & 50+ Banks": "SBI, HDFC, ICICI, Axis और 50+ बैंक",
  "🔒 256-bit SSL encrypted payment": "🔒 256-बिट सुरक्षित एन्क्रिप्टेड भुगतान",

  // Invoice Modal
  "INVOICE / CASH MEMO": "बिल / कैश मेमो",
  "Instant Hyperlocal Delivery · Haveli Kharagpur": "हाइपरलोकल क्विक डिलीवरी · हवेली खरगपुर",
  "Billed to:": "बिल प्राप्तकर्ता:",
  "Customer": "ग्राहक",
  "Phone:": "फोन:",
  "Address:": "पता:",
  "Order ID:": "ऑर्डर आईडी:",
  "Item": "सामान",
  "Qty": "मात्रा",
  "Price": "दर",
  "Total": "योग",
  "Subtotal:": "उप-योग:",
  "Delivery Fee:": "डिलीवरी शुल्क:",
  "Discount:": "छूट:",
  "Grand Total Paid:": "कुल भुगतान राशि:",
  "🖨️ Print / Save PDF": "🖨️ प्रिंट / PDF सेव करें",

  // Offline & Closed
  "📡 You're currently offline. Browsing saved catalogue.": "📡 आप अभी ऑफलाइन हैं। सेव किया हुआ कैटलॉग देख रहे हैं।",
  "Store is currently closed": "स्टोर अभी बंद है",
  "We will open soon for instant 10-min delivery.": "10 मिनट की तेज़ डिलीवरी के लिए स्टोर जल्द खुलेगा।",
  "Browse catalogue anyway": "फिर भी कैटलॉग देखें",

  // Placeholders
  "Search \"milk, bread & eggs\"": "खोजें \"दूध, ब्रेड और अंडे\"",
  "Enter coupon code (e.g. WELCOME50)": "कूपन कोड डालें (उदा. WELCOME50)",
  "e.g. Ramesh Kumar": "उदा. रमेश कुमार",
  "e.g. 9876543210": "उदा. 9876543210",
  "House / Flat / Shop No., Building Name, Street": "मकान / फ्लैट / दुकान नं., भवन का नाम, सड़क",
  "Near Shiv Mandir / Gandhi Chowk": "शिव मंदिर / गांधी चौक के पास",
  "Enter 10-digit mobile number": "10 अंकों का मोबाइल नंबर दर्ज करें",

  // Toasts
  "You are back online!": "आप वापस ऑनलाइन आ गए हैं!",
  "Saved address loaded!": "सेव किया गया पता लोड हो गया!",
  "Previous order items added to basket!": "पिछले ऑर्डर का सामान टोकरी में जोड़ा गया!",
  "Items added to your basket!": "सामान आपकी टोकरी में जोड़ा गया!",
  "Your cart is empty": "आपकी टोकरी खाली है",
  "Please enter a valid 10-digit mobile number": "कृपया वैध 10 अंकों का मोबाइल नंबर दर्ज करें",
  "Invalid coupon code": "अमान्य कूपन कोड",
  "Order placed successfully!": "ऑर्डर सफलतापूर्वक दर्ज हो गया!",
  "Order has been cancelled.": "ऑर्डर रद्द कर दिया गया।",
  "Order cancelled.": "ऑर्डर रद्द कर दिया गया।",
  "Could not cancel order.": "ऑर्डर रद्द नहीं किया जा सका।",
  "Thank you for rating your delivery! ⭐": "डिलीवरी को रेटिंग देने के लिए धन्यवाद! ⭐",
  "No order selected": "कोई ऑर्डर चयनित नहीं है",
  "Locating your Kharagpur address...": "आपका खरगपुर पता ढूंढा जा रहा है...",
  "Voice input not heard. Please type.": "आवाज़ सुनाई नहीं दी। कृपया लिखकर खोजें।",
  "Start Shopping": "खरीदारी शुरू करें"
};

function t(text) {
  if (language === "hi") {
    return translations[text] || text;
  }
  return text;
}

const originalTextNodes = new Map();
const originalAttrNodes = new Map();

function initTranslations() {
  if (originalTextNodes.size > 0) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest("script, style, code, pre, noscript, svg")) continue;
    const val = node.nodeValue;
    const trimmed = val.trim();
    if (trimmed && translations[trimmed]) {
      originalTextNodes.set(node, val);
    }
  }

  document.querySelectorAll("input, textarea, select, [title], [aria-label]").forEach(el => {
    const orig = {};
    if (el.hasAttribute("placeholder")) orig.placeholder = el.getAttribute("placeholder");
    if (el.hasAttribute("title")) orig.title = el.getAttribute("title");
    if (el.hasAttribute("aria-label")) orig.ariaLabel = el.getAttribute("aria-label");
    if (el.tagName === "OPTION") orig.text = el.textContent;
    if (Object.keys(orig).length > 0) {
      originalAttrNodes.set(el, orig);
    }
  });
}

function applyTranslations() {
  initTranslations();
  const hi = language === "hi";
  document.documentElement.lang = language;

  // Header language toggle pill
  const toggle = document.getElementById("lang-toggle");
  if (toggle) {
    toggle.textContent = hi ? "EN" : "हिं";
    toggle.title = hi ? "Switch to English (अंग्रेज़ी में बदलें)" : "Switch to Hindi (हिंदी में बदलें)";
    toggle.setAttribute("aria-label", hi ? "Switch to English" : "Switch to Hindi");
  }

  // Drawer language indicator
  const drawerLang = document.getElementById("drawer-lang-name");
  if (drawerLang) {
    drawerLang.textContent = hi ? "हिंदी" : "English";
  }

  // Apply or revert static text nodes
  for (const [node, originalVal] of originalTextNodes.entries()) {
    if (!node.parentElement) continue;
    if (hi) {
      const trimmed = originalVal.trim();
      const translated = translations[trimmed];
      if (translated) {
        node.nodeValue = originalVal.replace(trimmed, translated);
      }
    } else {
      node.nodeValue = originalVal;
    }
  }

  // Apply or revert attributes and options
  for (const [el, orig] of originalAttrNodes.entries()) {
    if (orig.placeholder) {
      el.placeholder = hi ? (translations[orig.placeholder] || orig.placeholder) : orig.placeholder;
    }
    if (orig.title) {
      el.title = hi ? (translations[orig.title] || orig.title) : orig.title;
    }
    if (orig.ariaLabel) {
      el.setAttribute("aria-label", hi ? (translations[orig.ariaLabel] || orig.ariaLabel) : orig.ariaLabel);
    }
    if (orig.text && el.tagName === "OPTION") {
      el.textContent = hi ? (translations[orig.text] || orig.text) : orig.text;
    }
  }

  // Bottom navigation elements
  const bottomNavHome = document.getElementById("nav-home");
  if (bottomNavHome) bottomNavHome.textContent = hi ? "होम" : "Home";
  const bottomNavCategories = document.getElementById("nav-categories");
  if (bottomNavCategories) bottomNavCategories.textContent = hi ? "श्रेणियां" : "Categories";
  const bottomNavSearch = document.getElementById("nav-search");
  if (bottomNavSearch) bottomNavSearch.textContent = hi ? "खोजें" : "Search";
  const bottomNavOrders = document.getElementById("nav-orders");
  if (bottomNavOrders) bottomNavOrders.textContent = hi ? "ऑर्डर" : "Orders";
  const bottomNavCart = document.getElementById("nav-cart");
  if (bottomNavCart) bottomNavCart.textContent = hi ? "कार्ट" : "Cart";

  // Search input & coupon placeholder
  const search = document.getElementById("search-input");
  if (search) search.placeholder = hi ? 'खोजें "दूध, ब्रेड और अंडे"' : 'Search "milk, bread & eggs"';
  const coupon = document.getElementById("coupon-code");
  if (coupon) coupon.placeholder = hi ? "कूपन कोड डालें (उदा. WELCOME50)" : "Enter coupon code (e.g. WELCOME50)";
}

function setLanguage() {
  language = language === "en" ? "hi" : "en";
  localStorage.setItem("hk_lang", language);

  applyTranslations();

  renderCategories();
  renderCategoryMenu();
  renderFlashDeals();
  renderCuratedShelves();
  renderProducts();
  renderCart();
  updateLocationDisplay();
  updateWalletDisplay();

  if (currentModalProduct && !document.getElementById("product-modal").hidden) {
    openProductModal(currentModalProduct.id);
  }

  const ordersView = document.getElementById("orders-view");
  if (ordersView && !ordersView.hidden) {
    renderLiveOrder();
  }

  toast(language === "hi" ? "भाषा हिंदी में बदली गई" : "Language switched to English");
}

// -------------------------------------------------------------
// DYNAMIC SEARCH PLACEHOLDER ANIMATION
// -------------------------------------------------------------
function startSearchAnimation() {
  const input = document.getElementById("search-input");
  if (!input) return;
  const queries = {
    en: [
      'Search "milk, bread & eggs"',
      'Search "fresh tomatoes & onions"',
      'Search "aashirvaad atta & dal"',
      'Search "chips & cold drinks"',
      'Search "maggi & snacks"',
      'Search "paracetamol & first aid"'
    ],
    hi: [
      'खोजें "दूध, ब्रेड और अंडे"',
      'खोजें "टमाटर और प्याज़"',
      'खोजें "आटा और दाल"',
      'खोजें "चिप्स और कोल्ड ड्रिंक"',
      'खोजें "मैगी और स्नैक्स"',
      'खोजें "दवाई और फर्स्ट एड"'
    ]
  };
  let qIndex = 0;
  setInterval(() => {
    if (document.activeElement !== input && !input.value) {
      const currentQueries = queries[language] || queries.en;
      qIndex = (qIndex + 1) % currentQueries.length;
      input.setAttribute("placeholder", currentQueries[qIndex]);
    }
  }, 3200);
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------
document.addEventListener("click", event => {
  // Stepper / ADD buttons
  const action = event.target.closest("[data-action]");
  if (action) {
    const act = action.dataset.action;
    if (act === "plus") addItem(action.dataset.id, 1);
    else if (act === "minus") addItem(action.dataset.id, -1);
    else if (act === "cart-plus") addItem(action.dataset.id, 1);
    else if (act === "cart-minus") addItem(action.dataset.id, -1);
    else if (act === "clear-filters") clearFilters();
    else if (act === "quick-view") openProductModal(action.dataset.id);
    else if (act === "focus-search") {
      showView("home");
      const searchBox = document.getElementById("search-input");
      if (searchBox) {
        searchBox.focus();
        searchBox.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  // Category filter
  const cat = event.target.closest("[data-category]");
  if (cat) {
    category = cat.dataset.category;
    showFullHome();
    renderCategories();
    renderProducts();
    const prodAnchor = document.getElementById("products-anchor");
    if (prodAnchor) prodAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Quick category submenu
  const menuToggle = event.target.closest("[data-menu-toggle]");
  if (menuToggle) {
    const submenu = document.querySelector(`[data-submenu="${menuToggle.dataset.menuToggle}"]`);
    const open = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!open));
    if (submenu) submenu.hidden = open;
  }

  // Submenu item click
  const subItem = event.target.closest("[data-search-term]");
  if (subItem) {
    const term = subItem.dataset.searchTerm;
    document.getElementById("search-input").value = term;
    showFullHome();
    renderProducts();
    const prodAnchor = document.getElementById("products-anchor");
    if (prodAnchor) prodAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Quick search tags
  const tag = event.target.closest(".search-tag");
  if (tag) {
    const q = tag.dataset.query;
    const input = document.getElementById("search-input");
    input.value = q;
    document.getElementById("clear-search-btn").hidden = false;
    showFullHome();
    renderProducts();
  }

  // Modals close button
  const closeBtn = event.target.closest("[data-close-modal]");
  if (closeBtn) {
    const modalId = closeBtn.dataset.closeModal;
    const modal = document.getElementById(modalId);
    if (modal) modal.hidden = true;
  }

  // Backdrop click to close modals
  if (event.target.classList.contains("modal-backdrop")) {
    event.target.hidden = true;
  }

  // Tip Selector
  const tipBtn = event.target.closest(".tip-btn");
  if (tipBtn) {
    document.querySelectorAll(".tip-btn").forEach(b => b.classList.remove("selected"));
    tipBtn.classList.add("selected");
    selectedTip = Number(tipBtn.dataset.tip);
    renderCart();
  }

  // Delivery Instructions pills
  const instrPill = event.target.closest(".instruction-pill");
  if (instrPill) {
    const type = instrPill.dataset.instr;
    if (selectedInstructions.has(type)) {
      selectedInstructions.delete(type);
      instrPill.classList.remove("selected");
    } else {
      selectedInstructions.add(type);
      instrPill.classList.add("selected");
    }
  }

  // Quick Coupon pill
  const coupPill = event.target.closest(".quick-coupon-pill");
  if (coupPill) {
    applyCoupon(coupPill.dataset.coupon);
  }

  // Navigation views
  const viewBtn = event.target.closest("[data-view]");
  if (viewBtn) {
    const v = viewBtn.dataset.view;
    showView(v);
    if (viewBtn.dataset.scroll === "categories") showCategoriesOnly();
    else if (v === "home") showFullHome();
  }

  // Topbar triggers
  if (event.target.closest("#location-button")) {
    document.getElementById("location-drawer").hidden = false;
  }
  if (event.target.closest("#wallet-top-btn")) {
    document.getElementById("profile-drawer").hidden = false;
  }
  if (event.target.closest("#profile-top-btn")) {
    document.getElementById("profile-drawer").hidden = false;
  }
  if (event.target.closest("#sticky-cart")) {
    showView("cart");
  }

  // Locality selection in drawer
  const localityBtn = event.target.closest(".locality-item");
  if (localityBtn) {
    setLocation(localityBtn.dataset.area);
  }

  // Quick wallet add
  const walletAddBtn = event.target.closest(".add-wallet-btn");
  if (walletAddBtn) {
    addWalletBalance(walletAddBtn.dataset.add);
  }

  // Reorder buttons in orders list
  const reorderBtn = event.target.closest("[data-reorder]");
  if (reorderBtn) {
    const items = JSON.parse(reorderBtn.dataset.reorder);
    items.forEach(i => {
      const p = products.find(x => x.id === i.id) || i;
      cart[i.id] = { ...p, qty: (cart[i.id]?.qty || 0) + (i.qty || 1) };
    });
    saveCart(cart);
    renderCart();
    showView("cart");
    toast("Items added to your basket!");
  }

  // View invoice from orders card
  const invoiceBtn = event.target.closest("[data-invoice]");
  if (invoiceBtn) {
    const o = JSON.parse(invoiceBtn.dataset.invoice);
    openInvoice(o);
  }
});

// Search input & clear button
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
searchInput.addEventListener("input", () => {
  clearSearchBtn.hidden = !searchInput.value.trim();
  renderProducts();
});
clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  clearSearchBtn.hidden = true;
  renderProducts();
  searchInput.focus();
});

// Voice Search
const voiceSearchBtn = document.getElementById("voice-search-btn");
voiceSearchBtn.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const rec = new SpeechRecognition();
    rec.lang = language === "hi" ? "hi-IN" : "en-IN";
    toast("Listening... speak product name (e.g. Milk, Tomato, Atta)");
    rec.onresult = e => {
      const text = e.results[0][0].transcript;
      searchInput.value = text;
      clearSearchBtn.hidden = false;
      renderProducts();
      toast(`Searching for: "${text}"`);
    };
    rec.onerror = () => toast("Voice input not heard. Please type.");
    rec.start();
  } else {
    // Demonstration fallback
    const samples = ["Amul Milk", "Fresh Tomato", "Aashirvaad Atta", "Lays Chips", "Farm Eggs"];
    const pick = samples[Math.floor(Math.random() * samples.length)];
    searchInput.value = pick;
    clearSearchBtn.hidden = false;
    renderProducts();
    toast(`Voice recognized: "${pick}"`);
  }
});

// Geolocation detect button
document.getElementById("gps-detect-btn")?.addEventListener("click", () => {
  if ("geolocation" in navigator) {
    toast("Locating your Kharagpur address...");
    navigator.geolocation.getCurrentPosition(
      () => setLocation("Gandhi Chowk, Haveli Kharagpur - 811202"),
      () => setLocation("Haveli Kharagpur Main Bazar - 811202"),
      { timeout: 5000 }
    );
  } else {
    setLocation("Haveli Kharagpur Main Bazar - 811202");
  }
});

// Sort select
document.getElementById("sort-select").addEventListener("change", e => {
  sortBy = e.target.value;
  renderProducts();
});

// Coupon apply button
document.getElementById("apply-coupon").addEventListener("click", () => applyCoupon());

// Slot selector updates bill delivery fees
document.querySelectorAll('input[name="slot"]').forEach(el => {
  el.addEventListener("change", renderCart);
});

// Form checkout submit
document.getElementById("checkout-form").addEventListener("submit", placeOrder);

// Autofill saved address button
document.getElementById("use-saved-address-btn").addEventListener("click", () => {
  const saved = JSON.parse(localStorage.getItem("hk_customer") || "{}");
  const form = document.getElementById("checkout-form");
  ["name", "phone", "address", "landmark", "area"].forEach(f => {
    if (saved[f] && form.elements[f]) form.elements[f].value = saved[f];
  });
  toast("Saved address loaded!");
});

// Orders look up
document.getElementById("orders-look-up").addEventListener("submit", e => {
  e.preventDefault();
  findOrders(e.currentTarget.elements.phone.value);
});

// Hero slide dots
document.querySelector(".hero-dots")?.addEventListener("click", event => {
  const dot = event.target.closest("[data-slide]");
  if (dot) showHeroSlide(Number(dot.dataset.slide));
});

// Cancel & rating
document.getElementById("cancel-order").addEventListener("click", cancelActiveOrder);
document.getElementById("stars").addEventListener("click", e => {
  const b = e.target.closest("[data-rating]");
  if (b) submitRating(Number(b.dataset.rating));
});

// Repeat order
document.getElementById("repeat-order")?.addEventListener("click", () => {
  const last = JSON.parse(localStorage.getItem("hk_last_order") || "null");
  if (!last?.items?.length) return;
  last.items.forEach(i => {
    const p = products.find(x => x.id === i.id) || i;
    if (p.inStock !== false) {
      cart[i.id] = { ...i, ...p, qty: (cart[i.id]?.qty || 0) + (i.qty || 1) };
    }
  });
  saveCart(cart);
  renderCart();
  toast("Previous order items added to basket!");
});

// View invoice from success screen
document.getElementById("view-invoice-btn")?.addEventListener("click", () => openInvoice());

// Language toggles
document.getElementById("lang-toggle").addEventListener("click", setLanguage);
document.getElementById("drawer-lang-toggle")?.addEventListener("click", setLanguage);

// Drawer location trigger
document.getElementById("drawer-location-trigger")?.addEventListener("click", () => {
  document.getElementById("profile-drawer").hidden = true;
  document.getElementById("location-drawer").hidden = false;
});

// Image fallback handler
document.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.dataset.imageFailed) return;
  image.dataset.imageFailed = "true";
  image.src = image.dataset.fallback || fallbackImage(image.alt || "Fresh Product");
}, true);

// Online / offline banners
window.addEventListener("online", () => {
  document.getElementById("offline-banner").hidden = true;
  toast("You are back online!");
});
window.addEventListener("offline", () => {
  document.getElementById("offline-banner").hidden = false;
});

// Flash Deal countdown timer
function startFlashCountdown() {
  const timerEl = document.getElementById("deal-timer");
  if (!timerEl) return;
  let seconds = 2 * 3600 + 44 * 60 + 18;
  setInterval(() => {
    seconds = Math.max(0, seconds - 1);
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    timerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// -------------------------------------------------------------
// APP BOOTSTRAP
// -------------------------------------------------------------
async function start() {
  document.getElementById("product-grid").innerHTML = `
    <div class="skeleton"></div><div class="skeleton"></div>
    <div class="skeleton"></div><div class="skeleton"></div>
    <div class="skeleton"></div><div class="skeleton"></div>
  `;
  applyTranslations();
  startSearchAnimation();
  startFlashCountdown();

  // Load saved customer details in form
  const saved = JSON.parse(localStorage.getItem("hk_customer") || "{}");
  const form = document.getElementById("checkout-form");
  ["name", "phone", "address", "landmark", "area"].forEach(f => {
    if (saved[f] && form.elements[f]) form.elements[f].value = saved[f];
  });

  await initFirebase();
  try {
    await loadData();
    applyTranslations();
  } catch (err) {
    console.error("Could not load catalogue", err);
    document.getElementById("product-grid").innerHTML = `
      <div class="empty-state">
        <h2>Catalogue loading issue</h2>
        <p>Please refresh the page to try again.</p>
        <button class="primary-button" type="button" onclick="location.reload()">Reload</button>
      </div>
    `;
    applyTranslations();
  }

  // Hero carousel auto slider
  setInterval(() => {
    const activeIndex = [...document.querySelectorAll(".hero-slide")].findIndex(s => s.classList.contains("active"));
    showHeroSlide(activeIndex + 1);
  }, 5000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

start();
