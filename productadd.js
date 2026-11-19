import { firebaseConfig } from "./firebase-config.js";

let app, db, auth, storage, signOutAdmin, f, shops=[], products=[], editingId=null;

const isConfigured=!firebaseConfig.apiKey?.startsWith("PASTE");
if(!isConfigured){location.href="./index.html";}

async function init(){
  const [{initializeApp},{getFirestore,collection,getDocs,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp},{getAuth,onAuthStateChanged,signOut},{getStorage,ref,uploadBytes,getDownloadURL}] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js")
  ]);
  app=initializeApp(firebaseConfig); db=getFirestore(app); auth=getAuth(app); storage=getStorage(app);
  signOutAdmin=signOut;
  f={collection,getDocs,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp,ref,uploadBytes,getDownloadURL};
  onAuthStateChanged(auth,async user=>{
    if(!user){alert("Sign in as an admin to open Product Manager.");location.href="./admin.html";return;}
    try{
      const adminDoc=await getDoc(doc(db,"admins",user.uid));
      if(!adminDoc.exists()){alert("Admin access required.");await signOut(auth);location.href="./admin.html";return;}
    }catch(error){console.error(error);}
    document.getElementById("auth-loading").hidden=true;
    document.getElementById("admin-content").hidden=false;
    await loadShops();
    listenProducts();
  });
  bind();
}

async function loadShops(){
  const snap=await f.getDocs(f.collection(db,"shops"));
  shops=snap.docs.map(d=>({id:d.id,...d.data()}));
  if(!shops.length) shops=[{id:"s1",name:"Kharagpur Staples"},{id:"s2",name:"Fresh Bazaar"},{id:"s3",name:"Dairy Corner"}];
  const options=shops.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join("");
  document.getElementById("shop-select").innerHTML=`<option value="">Select shop</option>${options}`;
  document.getElementById("shop-filter").innerHTML=`<option value="">All shops</option>${options}`;
}

function listenProducts(){
  f.onSnapshot(f.collection(db,"products"),snap=>{
    products=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderProducts();
  });
}

function renderProducts(){
  const search=document.getElementById("product-search").value.toLowerCase();
  const category=document.getElementById("category-filter").value;
  const shop=document.getElementById("shop-filter").value;
  const shown=products.filter(p=>(!search||`${p.name} ${p.nameHi||""}`.toLowerCase().includes(search))&&(!category||p.category===category)&&(!shop||p.shopId===shop));
  document.getElementById("product-count").textContent=`${shown.length} products`;
  document.getElementById("product-list").innerHTML=shown.length?shown.map(p=>`
    <article class="product-admin-row">
      <img src="${escape(p.image||"https://placehold.co/120x120/e8eee9/16a34a?text=P")}" alt="">
      <div class="product-admin-main"><strong>${escape(p.name)}</strong><small>${escape(p.category)} · ${escape(p.unit)} · ₹${Number(p.price||0)}</small></div>
      <label class="stock-toggle"><input type="checkbox" data-stock="${escape(p.id)}" ${p.inStock!==false?"checked":""}> In stock</label>
      <button type="button" class="secondary-button" data-edit="${escape(p.id)}">Edit</button>
      <button type="button" class="danger-small" data-delete="${escape(p.id)}">Delete</button>
    </article>`).join(""):"<p>No products match.</p>";
}

async function saveProduct(e){
  e.preventDefault();
  const form=e.currentTarget;
  if(!form.reportValidity())return;
  const data=new FormData(form);
  let image=String(data.get("image")||"").trim();
  const file=data.get("imageFile");
  if(file?.size){
    const path=`product-images/${Date.now()}-${file.name.replace(/[^a-z0-9.-]/gi,"_")}`;
    const uploadRef=f.ref(storage,path);
    await f.uploadBytes(uploadRef,file);
    image=await f.getDownloadURL(uploadRef);
  }
  const payload={
    name:String(data.get("name")).trim(),
    nameHi:String(data.get("nameHi")).trim(),
    category:String(data.get("category")),
    shopId:String(data.get("shopId")),
    price:Number(data.get("price")),unit:String(data.get("unit")).trim(),
    image,description:String(data.get("description")).trim(),inStock:data.get("inStock")==="on",
    updatedAt:f.serverTimestamp()
  };
  if(!payload.name||payload.price<=0||!payload.shopId||!payload.unit){toast("Complete all required fields");return;}
  if(editingId) await f.updateDoc(f.doc(db,"products",editingId),payload);
  else await f.addDoc(f.collection(db,"products"),{...payload,createdAt:f.serverTimestamp()});
  toast(editingId?"Product updated":"Product added");
  resetForm();
}

function resetForm(){
  editingId=null;document.getElementById("form-title").textContent="Add product";
  document.getElementById("product-form").reset();
  document.querySelector('[name="inStock"]').checked=true;
  document.getElementById("image-preview").hidden=true;
}

function editProduct(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  editingId=id;document.getElementById("form-title").textContent="Edit product";
  const form=document.getElementById("product-form");
  ["name","nameHi","category","shopId","price","unit","image","description"].forEach(name=>{
    if(form.elements[name])form.elements[name].value=p[name]||"";
  });
  form.elements.inStock.checked=p.inStock!==false;
  preview(p.image);window.scrollTo({top:0,behavior:"smooth"});
}

async function deleteProduct(id){
  if(!confirm("Delete this product?"))return;
  await f.deleteDoc(f.doc(db,"products",id));toast("Product deleted");
}

function preview(url){
  const img=document.getElementById("image-preview");
  if(url){img.src=url;img.hidden=false}else img.hidden=true;
}

function parseCSV(text){
  const lines=text.trim().split(/\r?\n/);if(lines.length<2)return[];
  const headers=lines.shift().split(",").map(v=>v.trim());
  return lines.filter(Boolean).map(line=>{
    const values=line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g).map(v=>v.replace(/,$/,"").replace(/^"|"$/g,"").replace(/""/g,'"').trim());
    const row={};headers.forEach((h,i)=>row[h]=values[i]||"");
    row.price=Number(row.price);row.inStock=String(row.inStock).toLowerCase()!=="false";
    return row;
  });
}

async function bulkAdd(){
  let items=[];const file=document.getElementById("bulk-file").files[0];
  if(file){const text=await file.text();items=file.name.toLowerCase().endsWith(".csv")?parseCSV(text):JSON.parse(text);}
  else{const text=document.getElementById("bulk-json").value.trim();if(text)items=JSON.parse(text);}
  if(!Array.isArray(items)||!items.length){toast("Provide valid CSV or JSON");return;}
  let count=0;
  for(const item of items){
    if(!item.name||!item.category||!item.shopId||Number(item.price)<=0)continue;
    await f.addDoc(f.collection(db,"products"),{...item,price:Number(item.price),inStock:item.inStock!==false,createdAt:f.serverTimestamp()});
    count++;
  }
  toast(`${count} products added`);
  document.getElementById("bulk-json").value="";
  document.getElementById("bulk-file").value="";
}

function bind(){
  document.getElementById("product-form").addEventListener("submit",saveProduct);
  document.getElementById("image-url").addEventListener("input",e=>preview(e.target.value));
  document.querySelector('[name="imageFile"]').addEventListener("change",e=>{
    const file=e.target.files[0];if(file)preview(URL.createObjectURL(file));
  });
  document.getElementById("product-search").addEventListener("input",renderProducts);
  document.getElementById("category-filter").addEventListener("change",renderProducts);
  document.getElementById("shop-filter").addEventListener("change",renderProducts);
  document.getElementById("bulk-add").addEventListener("click",bulkAdd);
  document.getElementById("logout").addEventListener("click",async()=>{await signOutAdmin(auth);location.href="./admin.html";});
  document.getElementById("product-list").addEventListener("click",async e=>{
    const edit=e.target.closest("[data-edit]");if(edit)editProduct(edit.dataset.edit);
    const del=e.target.closest("[data-delete]");if(del)await deleteProduct(del.dataset.delete);
  });
  document.getElementById("product-list").addEventListener("change",async e=>{
    const stock=e.target.closest("[data-stock]");if(stock)await f.updateDoc(f.doc(db,"products",stock.dataset.stock),{inStock:stock.checked});
  });
}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600);}
function escape(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}

init();
