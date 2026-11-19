# Kharagpur Fresh

Mobile-first grocery delivery app for Haveli Kharagpur, Munger, Bihar. It uses only HTML, CSS and vanilla JavaScript ES modules.

## Run locally

From this folder, run a local static server:

```powershell
python -m http.server 8080
```

Open `http://localhost:8080`. Do not open HTML files with `file://`; ES modules and service workers require HTTP.

The app uses `seed.json` until real Firebase configuration is added. This lets you test the storefront immediately.

## Files

- `index.html`, `app.js`, `cart.js`: customer storefront, cart, checkout, orders and rating
- `productadd.html`, `productadd.js`: protected product manager
- `admin.html`, `admin.js`: admin dashboard
- `delivery.html`, `delivery.js`: delivery agent app
- `firebase-config.js`: shared Firebase configuration
- `firestore.rules`: database security rules
- `sw.js`: PWA and catalogue cache
- `firebase-messaging-sw.js`: background FCM handler

## Create and configure Firebase

1. Create a Firebase project and a Web App in **Project settings**.
2. Copy the web app values into `firebase-config.js`.
3. Replace `PASTE_PROJECT_ID` in `.firebaserc`.
4. Enable **Authentication > Sign-in method > Email/Password**.
5. Create **Firestore Database** in production mode.
6. Enable **Storage** and apply appropriate storage rules.
7. Enable **Cloud Messaging**. Create a Web Push certificate and paste its VAPID key as `vapidKey`.

### Create admin account

1. In Authentication, add an email/password user.
2. In Firestore, create collection `admins`, document ID equal to that user's UID, with `{ "active": true }`.
3. Sign in at `admin.html`. Product management is separately available at `productadd.html`.

### Create delivery agent account

1. Add an email/password user in Authentication.
2. Create `deliveryAgents/{uid}` with:

```json
{"name":"Raju Kumar","phone":"9876543210","active":true,"online":true,"payoutPerDelivery":30}
```

3. Sign in at `delivery.html`.

## Store settings and WhatsApp

Set `settings/store` from the admin Settings tab. Fields:

- `deliveryFee`: delivery charge
- `freeDeliveryAbove`: subtotal for free delivery
- `urgentFee`: extra urgent charge
- `minOrder`: minimum normal grocery order
- `storeWhatsApp`: international store WhatsApp number, for example `919876543210`
- `storeOpen`, `openTime`, `closeTime`, `announcement`

No code change is needed when these values change. Restart/reload the storefront after a setting change.

## Deploy to Firebase Hosting

```powershell
npm install -g firebase-tools
firebase login
firebase use PASTE_PROJECT_ID
firebase deploy --only hosting,firestore
```

If deploying from Windows, use PowerShell with a static server for local testing; the hosted app is best tested over HTTPS.

## FCM push notifications

The included Firestore realtime listener and loud notification fallback work while `delivery.html` is open.

Server-generated background push notifications require Firebase Cloud Messaging and a server sender. A Firebase Cloud Function and Blaze billing plan are needed if you want notifications to send automatically after order creation or assignment. The free client fallback handles open-page assignments.

## Seed data

`seed.json` contains 30 sample products. To add it to Firestore, use the JSON bulk importer in `productadd.html` after signing in, or upload the file in the bulk add box.

## End-to-end test

1. Run locally or deploy.
2. Add a product at `productadd.html`; confirm it appears in `index.html`.
3. Place an order; choose a slot and payment method.
4. Confirm the order appears in `admin.html`.
5. Assign it to an agent and change status.
6. Open `delivery.html`, allow notifications, accept the order and change it through Picked Up to Delivered.
7. Keep the customer success view open and verify live status.
8. Check `admin.html` ledger and rating collection.
