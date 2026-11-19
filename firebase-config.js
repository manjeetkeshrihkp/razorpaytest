// Firebase & Razorpay Configuration for Kharagpur Fresh Quick Commerce
// ======================================================================

// 1. FIREBASE CONFIGURATION
// Paste values from Firebase Console > Project Settings > General > Your apps.
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
  vapidKey: "PASTE_FCM_VAPID_KEY"
};

// 2. RAZORPAY PAYMENT GATEWAY CONFIGURATION
// Live credentials for Kharagpur Fresh
export const razorpayConfig = {
  keyId: "rzp_live_U23PqoG9JP1kE5",
  keySecret: "f5rr4wnQ4WhrIOU0P0MGJkCx", // Kept for server-side verification / backend APIs
  companyName: "Kharagpur Fresh",
  description: "Instant 10-Min Grocery Delivery",
  themeColor: "#0c831f",
  currency: "INR"
};

// Helper flags
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE")
);

export const isRazorpayConfigured = Boolean(
  razorpayConfig.keyId && !razorpayConfig.keyId.startsWith("PASTE")
);
