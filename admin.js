import { firebaseConfig } from "./firebase-config.js";

let db,auth,f,orders=[],shops=[],agents=[],ledger=[],coupons=[],signIn,signOutUser;
const isConfigured=!firebaseConfig.apiKey?.startsWith("PASTE");

async function init(){
  if(!isConfigured){showDemoLogin();return;}
  const [{initializeApp},{getFirestore,collection,getDocs,getDoc,doc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp,query,orderBy},{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,createUserWithEmailAndPassword}] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js")
  ]);
  const app=initializeApp(firebaseConfig);db=getFirestore(app);auth=getAuth(app);
  signIn=signInWithEmailAndPassword;signOutUser=signOut;
  f={collection,getDocs,getDoc,doc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp,query,orderBy,signOut};
  onAuthStateChanged(auth,async user=>{
    if(!user){showLogin();return;}
    const admin=await f.getDoc(f.doc(db,"admins",user.uid));
    if(!admin.exists()){await signOut(auth);toast("Admin access required");showLogin();return;}
    showDashboard();
  });
  bindAuth();
}

function showDemoLogin(){
  const form=document.getElementById("login-view");
  form.addEventListener("submit",e=>{e.preventDefault();showDashboard();});
  form.querySelector("p").innerHTML="Firebase is not configured yet. This demo dashboard is available for UI testing.";
}

function showLogin(){
  document.getElementById("login-view").hidden=false;
  document.getElementById("dashboard").hidden=true;
  document.getElementById("logout").hidden=true;
}
function showDashboard(){
  document.getElementById("login-view").hidden=true;
  document.getElementById("dashboard").hidden=false;
  document.getElementById("logout").hidden=false;
  if(db)loadRealtime();
  else loadDemo();
}
function bindAuth(){
  document.getElementById("login-view").addEventListener("submit",async e=>{
    e.preventDefault();const d=new FormData(e.currentTarget);
    try{await signIn(auth,d.get("email"),d.get("password"));}catch(err){toast(err.message);}
  });
  document.getElementById("logout").addEventListener("click",async()=>{await f.signOut(auth);showLogin();});
}

function loadRealtime(){
  f.onSnapshot(f.collection(db,"orders"),snap=>{orders=snap.docs.map(d=>({id:d.id,...d.data()}));renderOrders();renderBatches();renderLedger();renderAnalytics();});
  f.onSnapshot(f.collection(db,"shops"),snap=>{shops=snap.docs.map(d=>({id:d.id,...d.data()}));renderShops();renderOrders();});
  f.onSnapshot(f.collection(db,"deliveryAgents"),snap=>{agents=snap.docs.map(d=>({id:d.id,...d.data()}));renderAgents();renderOrders();});
  f.onSnapshot(f.collection(db,"ledger"),snap=>{ledger=snap.docs.map(d=>({id:d.id,...d.data()}));renderLedger();});
  f.onSnapshot(f.collection(db,"coupons"),snap=>{coupons=snap.docs.map(d=>({id:d.id,...d.data()}));renderCoupons();});
  f.onSnapshot(f.doc(db,"settings","store"),snap=>{if(snap.exists())fillSettings(snap.data());});
}
function loadDemo(){
  shops=[{id:"s1",name:"Kharagpur Staples",phone:"",category:"Grocery",commissionPercent:5},{id:"s2",name:"Fresh Bazaar",phone:"",category:"Vegetables",commissionPercent:5},{id:"s3",name:"Dairy Corner",phone:"",category:"Dairy",commissionPercent:8},{id:"s6",name:"Town Kitchen",phone:"",category:"Ready Food",commissionPercent:8}];
  agents=[{id:"a1",name:"Raju Kumar",phone:"9876543210",active:true,payoutPerDelivery:30},{id:"a2",name:"Sunil Das",phone:"9876543211",active:true,payoutPerDelivery:30}];
  orders=[];ledger=[];coupons=[];renderShops();renderAgents();renderOrders();renderBatches();renderLedger();renderAnalytics();fillSettings({minOrder:100,deliveryFee:0,freeDeliveryAbove:500,urgentFee:30,storeOpen:true});
}

function renderOrders(){
  const status=document.getElementById("status-filter").value;
  const slot=document.getElementById("slot-filter").value;
  const date=document.getElementById("date-filter").value;
  const shown=orders.filter(o=>(!status||o.status===status)&&(!slot||o.slot===slot)&&(!date||dateKey(o.createdAt)===date));
  document.getElementById("orders-list").innerHTML=shown.length?shown.map(orderCard).join(""):"<p>No matching orders.</p>";
}
function orderCard(o){
  const c=o.customer||{};const agentOptions=`<option value="">Assign agent</option>`+agents.map(a=>`<option value="${escape(a.id)}" ${o.assignedAgentId===a.id?"selected":""}>${escape(a.name)}</option>`).join("");
  const statusOptions=["New","Accepted","Out for Delivery","Delivered","Cancelled"].map(s=>`<option ${o.status===s?"selected":""}>${s}</option>`).join("");
  const items=(o.items||[]).map(i=>`${i.qty}× ${escape(i.name)} (${escape(i.unit||"")})`).join(", ");
  const wa=`https://wa.me/91${String(c.phone||"").replace(/\D/g,"")}?text=${encodeURIComponent(`Hello ${c.name||""}, regarding your order ${o.id}.`)}`;
  return `<article class="admin-order" data-order="${escape(o.id)}">
    <div class="admin-order-head"><div><strong>${escape(o.id)}</strong><br><small>${escape(c.name||"-")} · ${escape(c.phone||"-")}</small></div><strong>₹${Number(o.grandTotal||0)}</strong></div>
    <p><strong>${escape(o.slot||"-")}</strong> · ${escape(o.payment||"-")} · ${escape(o.area||"")}</p>
    <p>${items||"No items"}</p><p>${escape(c.address||"")} ${escape(c.landmark?`(${c.landmark})`:"")}</p>
    <div class="admin-order-actions"><select data-status>${statusOptions}</select><select data-agent>${agentOptions}</select><button type="button" data-whatsapp>WhatsApp</button><button type="button" data-print>Print slip</button></div>
  </article>`;
}

async function updateOrder(id,payload){
  if(!db)return toast("Demo mode: connect Firebase to save");
  await f.updateDoc(f.doc(db,"orders",id),{...payload,updatedAt:f.serverTimestamp()});
  if(payload.status==="Delivered")await generateLedger(id);
  toast("Order updated");
}

async function generateLedger(orderId){
  if(!db)return;
  const o=orders.find(x=>x.id===orderId);if(!o)return;
  for(const shopId of [...new Set((o.items||[]).map(i=>i.shopId).filter(Boolean))]){
    const shopItems=(o.items||[]).filter(i=>i.shopId===shopId);
    const itemsTotal=shopItems.reduce((s,i)=>s+Number(i.price)*Number(i.qty),0);
    const shop=shops.find(s=>s.id===shopId);
    const commissionPercent=Number(shop?.commissionPercent||5);
    await f.setDoc(f.doc(db,"ledger",`${orderId}_${shopId}`),{orderId,shopId,itemsTotal,commissionPercent,commissionAmount:itemsTotal*commissionPercent/100,deliveryFee:Number(o.deliveryFee||0),riderCost:0,netEarning:itemsTotal-itemsTotal*commissionPercent/100,shopPaid:false,createdAt:f.serverTimestamp()},{merge:true});
  }
}

function renderShops(){
  document.getElementById("shops-list").innerHTML=shops.length?shops.map(s=>`
    <div class="shop-row" data-shop="${escape(s.id)}"><input data-field="name" value="${escape(s.name||"")}" placeholder="Name"><input data-field="phone" value="${escape(s.phone||"")}" placeholder="Phone"><input data-field="category" value="${escape(s.category||"")}" placeholder="Category"><input data-field="commissionPercent" type="number" value="${Number(s.commissionPercent||0)}" placeholder="%"><button type="button" class="danger-small" data-delete-shop>×</button></div>`).join(""):"<p>No shops.</p>";
}
async function saveShopRow(row){
  if(!db)return toast("Demo mode");
  const id=row.dataset.shop,data={};
  row.querySelectorAll("[data-field]").forEach(i=>data[i.dataset.field]=i.dataset.field==="commissionPercent"?Number(i.value):i.value);
  await f.setDoc(f.doc(db,"shops",id),data,{merge:true});toast("Shop saved");
}

function renderAgents(){
  document.getElementById("agents-list").innerHTML=agents.length?agents.map(a=>`
    <div class="agent-row" data-agent="${escape(a.id)}"><input data-field="name" value="${escape(a.name||"")}" placeholder="Name"><input data-field="phone" value="${escape(a.phone||"")}" placeholder="Phone"><input data-field="payoutPerDelivery" type="number" value="${Number(a.payoutPerDelivery||0)}" placeholder="Payout"><label class="stock-toggle"><input data-field="active" type="checkbox" ${a.active!==false?"checked":""}> Active</label><button type="button" class="danger-small" data-disable-agent>×</button></div>`).join(""):"<p>No agents.</p>";
}
async function saveAgentRow(row){
  if(!db)return toast("Demo mode");
  const data={};row.querySelectorAll("[data-field]").forEach(i=>data[i.dataset.field]=i.dataset.field==="payoutPerDelivery"?Number(i.value):i.dataset.field==="active"?i.checked:i.value);
  await f.setDoc(f.doc(db,"deliveryAgents",row.dataset.agent),data,{merge:true});toast("Agent saved");
}

function renderBatches(){
  const pending=orders.filter(o=>!["Delivered","Cancelled"].includes(o.status));
  const groups={};
  pending.forEach(o=>{const key=`${o.slot||"Unspecified"} · ${o.area||"Unknown area"} `;(groups[key]??=[]).push(o);});
  document.getElementById("batch-list").innerHTML=Object.keys(groups).length?Object.entries(groups).map(([key,list])=>{
    const shopCounts={};list.forEach(o=>(o.items||[]).forEach(i=>shopCounts[i.shopId||"Unknown"]=(shopCounts[i.shopId||"Unknown"]||0)+Number(i.qty||0)));
    const pickup=Object.entries(shopCounts).map(([id,count])=>{const shop=shops.find(s=>s.id===id);return `${shop?.name||id}: ${count} item(s)`;}).join("");
    return `<div class="batch-card"><strong>${escape(key)}</strong><p>${list.length} pending order(s)</p><div>Combined pickup: ${pickup}</div><ul>${list.map(o=>`<li>${escape(o.id)} — ${escape(o.customer?.name||"")} · ₹${Number(o.grandTotal||0)}</li>`).join("")}</ul></div>`;
  }).join(""):"<p>No pending orders.</p>";
}

function renderLedger(){
  let entries=ledger;
  if(db===undefined||!entries.length)entries=ledger;
  const totals=entries.reduce((a,l)=>{a.items+=Number(l.itemsTotal||0);a.commission+=Number(l.commissionAmount||0);a.rider+=Number(l.riderCost||0);return a;},{items:0,commission:0,rider:0});
  const owed={};entries.filter(l=>!l.shopPaid).forEach(l=>owed[l.shopId]=(owed[l.shopId]||0)+Number(l.netEarning||0));
  document.getElementById("ledger-list").innerHTML=`<div class="metric-grid"><div class="metric">Items<strong>₹${totals.items}</strong></div><div class="metric">Commission<strong>₹${totals.commission}</strong></div><div class="metric">Rider cost<strong>₹${totals.rider}</strong></div></div>`+(Object.keys(owed).length?Object.entries(owed).map(([id,amt])=>`<div class="ledger-row"><strong>${escape(shops.find(s=>s.id===id)?.name||id)}</strong><span>Owed: ₹${amt}</span><label><input type="checkbox" data-shop-paid="${escape(id)}"> Paid</label></div>`).join(""):"<p>No ledger entries.</p>");
}

function fillSettings(s){
  const form=document.getElementById("settings-form");
  ["minOrder","deliveryFee","freeDeliveryAbove","urgentFee","openTime","closeTime","storeWhatsApp","announcement"].forEach(k=>{if(form.elements[k])form.elements[k].value=s[k]??"";});
  form.elements.storeOpen.checked=s.storeOpen!==false;form.elements.hideOutOfStock.checked=s.hideOutOfStock===true;
}

async function saveSettings(e){
  e.preventDefault();const d=new FormData(e.currentTarget);
  const payload={minOrder:Number(d.get("minOrder")||100),deliveryFee:Number(d.get("deliveryFee")||0),freeDeliveryAbove:Number(d.get("freeDeliveryAbove")||500),urgentFee:Number(d.get("urgentFee")||0),openTime:d.get("openTime"),closeTime:d.get("closeTime"),storeWhatsApp:d.get("storeWhatsApp"),announcement:d.get("announcement"),storeOpen:d.get("storeOpen")==="on",hideOutOfStock:d.get("hideOutOfStock")==="on",updatedAt:f?.serverTimestamp?f.serverTimestamp():new Date().toISOString()};
  if(db){await f.setDoc(f.doc(db,"settings","store"),payload,{merge:true});}toast("Settings saved");
}

function renderCoupons(){
  document.getElementById("coupons-list").innerHTML=coupons.length?coupons.map(c=>`<div class="ledger-row"><input data-coupon-field="code" data-coupon="${escape(c.id)}" value="${escape(c.code||"")}"><input data-coupon-field="value" type="number" data-coupon="${escape(c.id)}" value="${Number(c.value||0)}"><select data-coupon-field="type" data-coupon="${escape(c.id)}"><option ${c.type==="percent"?"selected":""}>percent</option><option ${c.type==="flat"?"selected":""}>flat</option></select><label><input type="checkbox" data-coupon-active="${escape(c.id)}" ${c.active!==false?"checked":""}> Active</label><button type="button" class="danger-small" data-delete-coupon="${escape(c.id)}">×</button></div>`).join(""):"<p>No coupons.</p>";
}

function renderAnalytics(){
  const counts={},slots={},customers={};
  orders.forEach(o=>{slots[o.slot]=(slots[o.slot]||0)+1;if(o.customer?.phone)customers[o.customer.phone]=(customers[o.customer.phone]||0)+1;(o.items||[]).forEach(i=>counts[i.name]=(counts[i.name]||0)+Number(i.qty||0));});
  const repeat=Object.values(customers).filter(n=>n>1).length;
  const delivered=orders.filter(o=>o.status==="Delivered").length;
  document.getElementById("analytics-metrics").innerHTML=`<div class="metric">Orders<strong>${orders.length}</strong></div><div class="metric">Delivered<strong>${delivered}</strong></div><div class="metric">Repeat customers<strong>${repeat}</strong></div>`;
  document.getElementById("top-items").innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>`<div>${escape(name)}: <strong>${count}</strong></div>`).join("")||"<p>No sales yet.</p>";
  document.getElementById("slot-stats").innerHTML=Object.entries(slots).sort((a,b)=>b[1]-a[1]).map(([slot,count])=>`<div>${escape(slot)}: <strong>${count}</strong></div>`).join("")||"<p>No orders yet.</p>";
}

function dateKey(value){const d=value?.toDate?value.toDate():new Date(value||Date.now());return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function escape(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600);}

function bind(){
  document.querySelectorAll(".admin-tab").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll(".admin-tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    document.querySelectorAll(".admin-view").forEach(v=>v.hidden=true);document.getElementById(`view-${b.dataset.tab}`).hidden=false;
  }));
  ["status-filter","slot-filter","date-filter"].forEach(id=>document.getElementById(id).addEventListener("change",renderOrders));
  document.getElementById("orders-list").addEventListener("change",e=>{
    const card=e.target.closest("[data-order]");if(!card)return;
    if(e.target.matches("[data-status]"))updateOrder(card.dataset.order,{status:e.target.value});
    if(e.target.matches("[data-agent]"))updateOrder(card.dataset.order,{assignedAgentId:e.target.value||null,status:"Accepted"});
  });
  document.getElementById("orders-list").addEventListener("click",e=>{
    const card=e.target.closest("[data-order]");if(!card)return;
    if(e.target.matches("[data-whatsapp]")){const o=orders.find(x=>x.id===card.dataset.order);window.open(`https://wa.me/91${o?.customer?.phone||""}`,"_blank","noopener");}
    if(e.target.matches("[data-print]")){const o=orders.find(x=>x.id===card.dataset.order);printSlip(o);window.print();}
  });
  document.getElementById("shops-list").addEventListener("change",e=>{const row=e.target.closest("[data-shop]");if(row)saveShopRow(row);});
  document.getElementById("add-shop").addEventListener("click",async()=>{if(!db)return toast("Demo mode");const ref=await f.addDoc(f.collection(db,"shops"),{name:"New Shop",phone:"",category:"Grocery",commissionPercent:5});toast("Shop added");});
  document.getElementById("shops-list").addEventListener("click",async e=>{const b=e.target.closest("[data-delete-shop]");if(b){const row=b.closest("[data-shop]");if(confirm("Delete shop?")){await f.deleteDoc(f.doc(db,"shops",row.dataset.shop));}}});
  document.getElementById("agents-list").addEventListener("change",e=>{const row=e.target.closest("[data-agent]");if(row)saveAgentRow(row);});
  document.getElementById("add-agent").addEventListener("click",async()=>{if(!db)return toast("Demo mode");await f.addDoc(f.collection(db,"deliveryAgents"),{name:"New Agent",phone:"",active:true,payoutPerDelivery:30});toast("Agent profile added");});
  document.getElementById("agents-list").addEventListener("click",async e=>{const b=e.target.closest("[data-disable-agent]");if(b){const row=b.closest("[data-agent]");if(confirm("Disable/delete agent profile?"))await f.deleteDoc(f.doc(db,"deliveryAgents",row.dataset.agent));}});
  document.getElementById("settings-form").addEventListener("submit",saveSettings);
  document.getElementById("add-coupon").addEventListener("click",async()=>{if(!db)return toast("Demo mode");await f.addDoc(f.collection(db,"coupons"),{code:"NEW10",type:"percent",value:10,minOrder:100,active:true});});
  document.getElementById("coupons-list").addEventListener("change",async e=>{if(!db)return;const el=e.target;const id=el.dataset.coupon||el.dataset.couponActive;if(!id)return;if(el.dataset.couponField){const payload={};payload[el.dataset.couponField]=el.dataset.couponField==="value"?Number(el.value):el.value;await f.updateDoc(f.doc(db,"coupons",id),payload);}else if(el.dataset.couponActive)await f.updateDoc(f.doc(db,"coupons",id),{active:el.checked});});
  document.getElementById("coupons-list").addEventListener("click",async e=>{const b=e.target.closest("[data-delete-coupon]");if(b&&db&&confirm("Delete coupon?"))await f.deleteDoc(f.doc(db,"coupons",b.dataset.deleteCoupon));});
  document.getElementById("ledger-list").addEventListener("change",async e=>{const id=e.target.dataset.shopPaid;if(id&&db){}});
  document.getElementById("export-ledger").addEventListener("click",exportLedger);
}

function printSlip(o){
  if(!o)return;
  const win=window.open("","_blank");
  win.document.write(`<html><head><title>Order ${escape(o.id)}</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:8px;text-align:left}@media print{button{display:none}}</style></head><body><h2>Haveli Kharagpur Grocery</h2><p><strong>Order:</strong> ${escape(o.id)}</p><p>${escape(o.customer?.name)} · ${escape(o.customer?.phone)}<br>${escape(o.customer?.address)}</p><table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr>${(o.items||[]).map(i=>`<tr><td>${escape(i.name)}</td><td>${i.qty}</td><td>₹${Number(i.price)*Number(i.qty)}</td></tr>`).join("")}</table><h3>Total: ₹${Number(o.grandTotal||0)}</h3></body></html>`);win.document.close();
}
function exportLedger(){
  const rows=[["Order","Shop","Items Total","Commission %","Commission","Delivery","Rider Cost","Net Earning","Paid"],...ledger.map(l=>[l.orderId,l.shopId,l.itemsTotal,l.commissionPercent,l.commissionAmount,l.deliveryFee,l.riderCost,l.netEarning,l.shopPaid?"Yes":"No"])];
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="commission-ledger.csv";a.click();URL.revokeObjectURL(url);
}

bind();init();
