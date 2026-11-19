import { firebaseConfig } from "./firebase-config.js";

let db, auth, messagingApp, f, currentAgent=null, orders=[], popupOrderId=null, seenOrders=new Set();
const isConfigured=!firebaseConfig.apiKey?.startsWith("PASTE");

async function init(){
  if(!isConfigured){bindDemo();return;}
  const [{initializeApp},{getFirestore,collection,doc,getDoc,setDoc,updateDoc,onSnapshot,query,where,serverTimestamp},{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js")
  ]);
  messagingApp=initializeApp(firebaseConfig); db=getFirestore(messagingApp); auth=getAuth(messagingApp);
  f={collection,doc,getDoc,setDoc,updateDoc,onSnapshot,query,where,serverTimestamp};
  onAuthStateChanged(auth,async user=>{
    if(!user){showLogin();return;}
    const profile=await f.getDoc(f.doc(db,"deliveryAgents",user.uid));
    if(!profile.exists()){await signOut(auth);toast("Delivery agent profile required");showLogin();return;}
    currentAgent={id:user.uid,...profile.data()};
    if(currentAgent.active===false){toast("This agent profile is disabled");await signOut(auth);showLogin();return;}
    showAgent(profile.data());
  });
  dom("#login-view").addEventListener("submit",async e=>{
    e.preventDefault();const d=new FormData(e.currentTarget);
    try{await signInWithEmailAndPassword(auth,d.get("email"),d.get("password"));}catch(err){toast(err.message);}
  });
  dom("#logout").addEventListener("click",()=>signOut(auth).then(()=>showLogin()));
  bindActions();
}

function bindDemo(){
  dom("#login-view").addEventListener("submit",e=>{
    e.preventDefault();currentAgent={id:"a1",name:"Raju Kumar",phone:"9876543210",active:true,payoutPerDelivery:30};showAgent(currentAgent);
  });
  bindActions();
}
function dom(selector){return window.document.querySelector(selector);}
function showLogin(){dom("#login-view").hidden=false;dom("#agent-dashboard").hidden=true;}
function showAgent(profile){
  dom("#login-view").hidden=true;dom("#agent-dashboard").hidden=false;dom("#logout").hidden=false;
  dom("#agent-name").textContent=profile.name||"Delivery Agent";
  if(db){listenOrders();setupMessaging();}
  else{orders=[];renderOrders();renderSummary();}
}
function listenOrders(){
  f.onSnapshot(f.query(f.collection(db,"orders"),f.where("assignedAgentId","==",currentAgent.id)),snap=>{
    const added=snap.docChanges().filter(c=>c.type==="added").map(c=>c.doc.id);
    orders=snap.docs.map(d=>({id:d.id,...d.data()}));
    added.forEach(id=>{if(!seenOrders.has(id)){seenOrders.add(id);notifyNewOrder(orders.find(o=>o.id===id));}});
    renderOrders();renderSummary();
  });
}
function renderOrders(){
  const el=dom("#assigned-orders");
  const mine=orders.filter(o=>o.assignedAgentId===currentAgent?.id);
  el.innerHTML=mine.length?mine.map(orderCard).join(""):"<p>No active orders.</p>";
}
function orderCard(o){
  const c=o.customer||{};const maps=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.address||""}, ${c.area||""}, Haveli Kharagpur`)}`;
  const cod=o.payment==="Cash on Delivery"?`₹${Number(o.grandTotal||0)}`:"UPI / Prepaid";
  const shops=[...new Set((o.items||[]).map(i=>i.shopId).filter(Boolean))].join(", ")||"Check order items";
  return `<article class="admin-order" data-order="${escape(o.id)}">
    <div class="admin-order-head"><div><strong>${escape(c.name||"Customer")}</strong><br><a href="tel:+91${escape(c.phone||"")}">Call ${escape(c.phone||"-")}</a></div><strong>${cod}</strong></div>
    <p>${escape(c.address||"")} ${escape(c.landmark?`· ${c.landmark}`:"")}<br><strong>${escape(c.area||"")}</strong> · ${escape(o.slot||"")}</p>
    <p>${(o.items||[]).map(i=>`${i.qty}× ${escape(i.name)} (${escape(i.unit||"")})`).join(", ")}</p>
    <p><strong>Pickup:</strong> ${escape(shops)}</p>
    <a class="secondary-button" style="display:inline-grid;place-items:center;text-decoration:none" href="${maps}" target="_blank" rel="noopener">Open in Maps</a>
    <div class="admin-order-actions"><button type="button" data-status="Accepted">Accepted</button><button type="button" data-status="Out for Delivery">Picked Up</button><button type="button" data-status="Delivered">Delivered</button><label class="stock-toggle"><input type="checkbox" data-cash ${o.cashCollected?"checked":""}> Cash collected</label></div>
  </article>`;
}
async function updateStatus(id,status){
  if(!db){toast(`Demo: ${status}`);return;}
  await f.updateDoc(f.doc(db,"orders",id),{status,updatedAt:f.serverTimestamp(),assignedAgentId:currentAgent.id});
  toast(status);
}
function notifyNewOrder(o){
  if(!o)return;
  dom("#order-sound").play().catch(()=>{});
  if(navigator.vibrate)navigator.vibrate([300,100,300,100,500]);
  if("Notification" in window){
    if(Notification.permission==="granted")new Notification("New delivery request",{body:`${o.customer?.area||""} · ₹${Number(o.grandTotal||0)}`,tag:o.id});
    else if(Notification.permission==="default")Notification.requestPermission();
  }
  popupOrderId=o.id;
  dom("#popup-details").innerHTML=`<p><strong>${escape(o.customer?.name||"Customer")}</strong></p><p>${escape(o.customer?.address||"")} · ${escape(o.customer?.area||"")}</p><p>₹${Number(o.grandTotal||0)} · ${escape(o.slot||"")}</p>`;
  dom("#new-order-popup").hidden=false;
}
function renderSummary(){
  const today=orders.filter(o=>dateKey(o.createdAt)===dateKey(new Date())&&o.status==="Delivered");
  const cash=today.filter(o=>o.payment==="Cash on Delivery").reduce((s,o)=>s+Number(o.grandTotal||0),0);
  const payout=today.length*Number(currentAgent?.payoutPerDelivery||0);
  dom("#agent-summary").innerHTML=`<div class="metric">Deliveries<strong>${today.length}</strong></div><div class="metric">Cash collected<strong>₹${cash}</strong></div><div class="metric">Earnings<strong>₹${payout}</strong></div>`;
}
async function setupMessaging(){
  if(!messagingApp)return;
  try{
    if(!("Notification" in window)||!("serviceWorker" in navigator))return;
    await Notification.requestPermission();
    const [{getMessaging,getToken,onMessage}] = await Promise.all([import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js")]);
    const messaging=getMessaging(messagingApp);
    const registration=await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    const token=await getToken(messaging,{vapidKey:firebaseConfig.vapidKey,serviceWorkerRegistration:registration});
    if(token&&currentAgent)await f.updateDoc(f.doc(db,"deliveryAgents",currentAgent.id),{fcmToken:token});
    onMessage(messaging,p=>{if(p.notification)notifyNewOrder({id:p.data?.orderId||"Push",customer:{name:p.notification.title,address:p.notification.body}});});
  }catch(error){console.info("FCM unavailable:",error.message);}
}
function bindActions(){
  dom("#online-toggle").addEventListener("change",async e=>{
    dom("#online-label").textContent=e.target.checked?"Online":"Offline";
    if(db&&currentAgent)await f.updateDoc(f.doc(db,"deliveryAgents",currentAgent.id),{online:e.target.checked});
  });
  dom("#order-list").addEventListener("click",e=>{
    const button=e.target.closest("[data-status]");const card=e.target.closest("[data-order]");
    if(button&&card)updateStatus(card.dataset.order,button.dataset.status);
  });
  dom("#order-list").addEventListener("change",async e=>{
    const card=e.target.closest("[data-order]");
    if(card&&e.target.matches("[data-cash]")&&db)await f.updateDoc(f.doc(db,"orders",card.dataset.order),{cashCollected:e.target.checked});
  });
  dom("#accept-order").addEventListener("click",async()=>{
    if(popupOrderId&&db)await f.updateDoc(f.doc(db,"orders",popupOrderId),{status:"Accepted",assignedAgentId:currentAgent.id});
    popupOrderId=null;dom("#order-sound").pause();dom("#new-order-popup").hidden=true;renderOrders();
  });
  dom("#reject-order").addEventListener("click",()=>{
    popupOrderId=null;dom("#order-sound").pause();dom("#new-order-popup").hidden=true;
  });
}
function dateKey(value){const d=value?.toDate?value.toDate():new Date(value||Date.now());return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;}
function escape(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
function toast(message){const el=dom("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600);}

init();
