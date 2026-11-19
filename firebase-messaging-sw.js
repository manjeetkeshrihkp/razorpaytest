import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getMessaging, onBackgroundMessage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging/sw.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig);
const messaging=getMessaging(app);

onBackgroundMessage(messaging,payload=>{
  const title=payload.notification?.title||"New delivery request";
  const options={
    body:payload.notification?.body||"A new order is ready.",
    icon:"./icon.svg",
    badge:"./icon.svg",
    vibrate:[300,100,300,100,500],
    data:{orderId:payload.data?.orderId||""},
    tag:payload.data?.orderId||"delivery"
  };
  self.registration.showNotification(title,options);
});
