const HEADERS = ["AT ID","Sequence","Stop","SPX TN","Destination Address","Bairro","City","Zipcode/Postal code","Latitude","Longitude"];
const $ = id => document.getElementById(id);
let stops = JSON.parse(localStorage.getItem("shopeeRouteStops") || "[]");
let pendingCandidate = null;

function save(){ localStorage.setItem("shopeeRouteStops", JSON.stringify(stops)); render(); }
function normalizeAddress(value){
  return (value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[.,;#]/g," ").replace(/\s+/g," ").trim();
}
function groupStops(){
  const map=new Map();
  stops.forEach(s=>{
    const key=normalizeAddress(s.address);
    if(!key)return;
    if(!map.has(key))map.set(key,{...s,stopNumbers:[],items:[]});
    const g=map.get(key);if(s.stop!==undefined&&s.stop!==null&&String(s.stop).trim())g.stopNumbers.push(String(s.stop));g.items.push(s);
  });
  return [...map.values()].sort((a,b)=>{
    const an=Number(a.stopNumbers[0]),bn=Number(b.stopNumbers[0]);
    return (Number.isFinite(an)?an:999999)-(Number.isFinite(bn)?bn:999999);
  });
}
function exportGroupedRows(groups){
  return groups.map(group=>{
    const rows=group.items.map(item=>Array.isArray(item.values)?item.values:[]);
    const combined=column=>[...new Set(rows.map(row=>String(row[column]??"").trim()).filter(Boolean))].join(", ");
    const firstValue=column=>{
      for(const row of rows){
        const value=row[column];
        if(value!==undefined&&value!==null&&String(value).trim()!=="")return value;
      }
      return "";
    };
    const values=HEADERS.map((_,column)=>firstValue(column));
    values[0]=combined(0);
    values[1]=combined(1);
    const originalStops=group.stopNumbers.join(" / ");
    values[2]=`${originalStops||"Parada não informada"} (${group.items.length} ${group.items.length===1?"pacote":"pacotes"})`;
    values[3]=combined(3);
    values[4]=group.address||firstValue(4);
    return values;
  });
}
function render(){
  const groups=groupStops(), packages=stops.length, repeatedPackages=packages-groups.length;
  $("stopCount").textContent = `${packages} ${packages===1?"pacote":"pacotes"}`;
  $("totalStops").textContent=packages;$("uniqueStops").textContent=groups.length;$("duplicates").textContent=repeatedPackages;
  $("emptyState").classList.toggle("hidden", packages>0);
  $("exportButton").disabled = packages===0;$("csvButton").disabled = packages===0;$("stopsList").innerHTML = "";
  groups.forEach(g=>{
    const el=document.createElement("div"); el.className="stop-card";
    const num=document.createElement("div"); num.className="stop-num"; num.textContent=g.items.length;
    const info=document.createElement("div"); info.className="stop-info";
    const title=document.createElement("strong"); title.textContent=g.address;
    const desc=document.createElement("p"); desc.textContent=[g.neighborhood,g.city||"Anápolis-GO"].filter(Boolean).join(" • ");
    const sub=document.createElement("p");sub.className="subline";sub.textContent=`Pacotes: ${g.items.length} • Parada(s) Shopee: ${g.stopNumbers.length?g.stopNumbers.join(", "):"não informada(s)"}`;
    info.append(title,desc,sub);
    if(g.items.length>1){const tag=document.createElement("span");tag.className="group-tag";tag.textContent=`${g.items.length} pacotes agrupados nesta parada`;info.append(tag);}
    const del=document.createElement("button"); del.className="remove"; del.type="button"; del.textContent="Remover grupo"; del.setAttribute("aria-label",`Remover grupo ${g.address}`);
    del.onclick=()=>{const key=normalizeAddress(g.address);stops=stops.filter(s=>normalizeAddress(s.address)!==key);save();};
    el.append(num,info,del); $("stopsList").append(el);
  });
}
function showValidation(kind,title,message,extra=""){
  const box=$("validationBox"); box.className=`validation ${kind}`;box.replaceChildren();
  const strong=document.createElement("strong"); strong.textContent=title;
  const p=document.createElement("p"); p.textContent=message;box.append(strong,p);
  if(extra){const q=document.createElement("p");q.textContent=extra;box.append(q);}box.classList.remove("hidden");
}
function showImportStatus(kind,title,message){
  const box=$("importStatus");box.className=`validation ${kind}`;box.replaceChildren();
  const strong=document.createElement("strong");strong.textContent=title;
  const p=document.createElement("p");p.textContent=message;box.append(strong,p);box.classList.remove("hidden");
}
function normalize(s){return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();}
function isAnapolis(address){
  const vals=[address.city,address.town,address.village,address.municipality,address.county,address.city_district,address.state,address.country].filter(Boolean).join(" | ");
  const n=normalize(vals);return n.includes("anapolis") && n.includes("goias") && n.includes("brasil");
}
async function lookupAddress(address, neighborhood){
  const query=[address,neighborhood,"Anápolis","Goiás","Brasil"].filter(Boolean).join(", ");
  const params=new URLSearchParams({q:query,format:"jsonv2",addressdetails:"1",limit:"8",countrycodes:"br",viewbox:"-49.20,-16.15,-48.65,-16.55",bounded:"1"});
  const response=await fetch(`https://nominatim.openstreetmap.org/search?${params}`,{headers:{"Accept-Language":"pt-BR"}});
  if(!response.ok) throw new Error("O serviço de endereços não respondeu. Tente novamente.");
  const results=await response.json();return results.find(r=>isAnapolis(r.address||{}))||null;
}
$("importButton").onclick=async()=>{
  const file=$("shopeeFile").files[0];
  if(!file){showImportStatus("bad","Selecione a planilha","Escolha o arquivo .xlsx exportado pela Shopee.");return;}
  const btn=$("importButton");btn.disabled=true;btn.textContent="Lendo planilha...";
  try{
    if(!window.ExcelJS)throw new Error("A biblioteca Excel não carregou. Conecte-se à internet e tente novamente.");
    const buffer=await file.arrayBuffer();const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
    const sheet=workbook.getWorksheet("Sheet1")||workbook.worksheets[0];
    if(!sheet)throw new Error("Não encontrei uma aba com dados nessa planilha.");
    const headerRow=sheet.getRow(1);
    const headers=HEADERS.map((_,i)=>String(headerRow.getCell(i+1).text||headerRow.getCell(i+1).value||"").trim());
    if(HEADERS.some((h,i)=>headers[i]!==h))throw new Error("Essa planilha não tem os 10 cabeçalhos esperados do modelo Shopee. Confira se selecionou o arquivo correto.");
    const imported=[];
    for(let rowNo=2;rowNo<=sheet.rowCount;rowNo++){
      const row=sheet.getRow(rowNo);
      const values=HEADERS.map((_,i)=>{const cell=row.getCell(i+1);return cell.text!==undefined&&cell.text!==""?cell.text:(cell.value??"");});
      const address=String(values[4]??"").trim();if(!address)continue;
      imported.push({stop:String(values[2]??"").trim(),address,neighborhood:String(values[5]??"").trim(),city:String(values[6]??"Anápolis").trim()||"Anápolis",values});
    }
    if(!imported.length)throw new Error("Não encontrei nenhuma linha com Destination Address preenchido.");
    const unique= new Set(imported.map(p=>normalizeAddress(p.address))).size;
    if(!confirm(`A planilha contém ${imported.length} pacotes e ${unique} endereços únicos. Isso substituirá a rota atual. Continuar?`))return;
    stops=imported;save();
    showImportStatus("good","Planilha importada",`${imported.length} pacotes carregados e agrupados em ${unique} paradas únicas. Os endereços repetidos foram reunidos, mesmo quando os números de parada Shopee aparecem em linhas diferentes.`);
  }catch(err){showImportStatus("bad","Falha ao importar planilha",err.message||"Não foi possível ler o arquivo.");}
  finally{btn.disabled=false;btn.textContent="Importar e agrupar pacotes";}
};
$("stopForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const stop=$("stopNumber").value.trim(), address=$("address").value.trim(), neighborhood=$("neighborhood").value.trim();
  if(!stop||!address)return;
  if(stops.some(s=>String(s.stop)===stop)){showValidation("bad","Número já cadastrado","Já existe um registro com esse número de parada. Escolha outro número.");return;}
  $("validateButton").disabled=true;$("validateButton").textContent="Verificando...";$("validationBox").classList.add("hidden");
  try{
    const candidate=await lookupAddress(address,neighborhood);
    if(!candidate){showValidation("bad","Endereço não confirmado em Anápolis","Não encontrei um resultado que confirme simultaneamente Anápolis, Goiás e Brasil. Não vou cadastrar um endereço de outro município. Confira o logradouro e o bairro e tente novamente.");return;}
    pendingCandidate={stop,address,neighborhood,candidate};
    const box=$("validationBox");box.className="validation good";box.replaceChildren();
    const strong=document.createElement("strong");strong.textContent="Confirme se este é o endereço correto";
    const p=document.createElement("p");p.textContent=candidate.display_name;
    const q=document.createElement("p");q.textContent="Resultado localizado em Anápolis-GO. Confira o número, a rua e o bairro antes de confirmar.";
    const yes=document.createElement("button");yes.className="confirm";yes.textContent="Confirmar e adicionar pacote";yes.onclick=confirmStop;
    const no=document.createElement("button");no.className="cancel";no.textContent="Não é esse endereço";no.onclick=()=>{pendingCandidate=null;box.classList.add("hidden");};
    box.append(strong,p,q,yes,no);
  }catch(err){showValidation("bad","Não foi possível verificar",err.message||"Verifique sua conexão e tente novamente.");}
  finally{$("validateButton").disabled=false;$("validateButton").textContent="Verificar endereço";}
});
function confirmStop(){
  if(!pendingCandidate)return;
  const {stop,address,neighborhood}=pendingCandidate;
  stops.push({stop,address,neighborhood,city:"Anápolis",values:["","",stop,"",address,neighborhood,"Anápolis","","",""]});
  pendingCandidate=null;$("validationBox").classList.add("hidden");$("stopForm").reset();save();$("stopNumber").focus();
}
$("clearButton").onclick=()=>{if(!stops.length)return;if(confirm("Apagar todos os pacotes desta rota?")){stops=[];save();}};
function spokenStopNumber(transcript){
  const text=normalize(transcript).replace(/-/g," ").replace(/\s+/g," ").trim();
  if(/^\d+$/.test(text))return text;
  const units={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19};
  const tens={vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90};
  const words=text.split(" ").filter(word=>word!=="e");
  if(words.length===1&&units[words[0]]!==undefined)return String(units[words[0]]);
  if(words.length===1&&tens[words[0]]!==undefined)return String(tens[words[0]]);
  if(words.length===2&&tens[words[0]]!==undefined&&units[words[1]]!==undefined)return String(tens[words[0]]+units[words[1]]);
  if(words.length===1&&words[0]==="cem")return "100";
  return transcript.trim();
}
function startVoice(targetId,buttonId,fieldName){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){showValidation("bad","Ditado não disponível","Use o teclado por voz do seu celular ou abra o app no Chrome atualizado.");return;}
  const button=$(buttonId),recognition=new SpeechRecognition();
  recognition.lang="pt-BR";recognition.interimResults=false;recognition.maxAlternatives=1;
  button.textContent="…";button.disabled=true;
  recognition.onresult=e=>{
    const transcript=e.results[0][0].transcript.trim();
    $(targetId).value=targetId==="stopNumber"?spokenStopNumber(transcript):transcript;
    $(targetId).dispatchEvent(new Event("input",{bubbles:true}));
  };
  recognition.onerror=()=>showValidation("bad","Falha no ditado",`Não consegui reconhecer ${fieldName}. Verifique a permissão do microfone e tente novamente.`);
  recognition.onend=()=>{button.textContent="🎙";button.disabled=false;};
  try{recognition.start();}catch(error){button.textContent="🎙";button.disabled=false;showValidation("bad","Não foi possível iniciar o microfone","Tente novamente em alguns segundos.");}
}
$("voiceAddress").onclick=()=>startVoice("address","voiceAddress","endereço");
$("voiceStopNumber").onclick=()=>startVoice("stopNumber","voiceStopNumber","número da parada");
$("voiceNeighborhood").onclick=()=>startVoice("neighborhood","voiceNeighborhood","bairro");
$("exportButton").onclick=async()=>{
  const btn=$("exportButton");btn.disabled=true;btn.textContent="Gerando Excel...";
  try{
    if(!window.ExcelJS)throw new Error("A biblioteca Excel não carregou. Conecte-se à internet e atualize a página.");
    const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet("Sheet1");
    sheet.addRow(HEADERS);sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];
    const groupedRows=exportGroupedRows(groupStops());
    groupedRows.forEach(values=>sheet.addRow(values));
    sheet.autoFilter={from:"A1",to:`J${Math.max(1,stops.length+1)}`};
    const out=await workbook.xlsx.writeBuffer();const blob=new Blob([out],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`Shopee_Rota_Anapolis_${new Date().toISOString().slice(0,10)}.xlsx`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    btn.textContent="Planilha exportada";setTimeout(()=>btn.textContent="Exportar planilha Excel Shopee",1800);
  }catch(err){showValidation("bad","Erro ao exportar",err.message);btn.textContent="Exportar planilha Excel Shopee";}
  finally{btn.disabled=stops.length===0;}
};
function csvEscape(value){const s=String(value??"");return `"${s.replace(/"/g,'""')}"`;}
$("csvButton").onclick=()=>{
  const groups=groupStops();
  const rows=[HEADERS,...exportGroupedRows(groups)];
  const output="\uFEFF"+rows.map(row=>row.map(csvEscape).join(",")).join("\r\n");
  const blob=new Blob([output],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=url;a.download=`Shopee_Rota_Circuit_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
window.addEventListener("online",()=>$("connectionStatus").textContent="Conectado");
window.addEventListener("offline",()=>$("connectionStatus").textContent="Sem internet");
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
render();