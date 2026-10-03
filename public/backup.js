// Backup e ripristino di clienti, schede e parrucchiere in un file JSON.
import {
  collection, doc, getDocs, writeBatch, Timestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const VERSIONE = 1;
const OPERAZIONI_PER_BLOCCO = 400; // Firestore accetta al massimo 500 scritture per volta

// Le date di Firestore diventano {"__data": "2026-10-03T10:00:00.000Z"} nel file, e tornano date al ripristino.
function inFile(valore) {
  if (valore instanceof Timestamp) return { __data: valore.toDate().toISOString() };
  if (Array.isArray(valore)) return valore.map(inFile);
  if (valore && typeof valore === "object") return Object.fromEntries(Object.entries(valore).map(([k, v]) => [k, inFile(v)]));
  return valore;
}

function daFile(valore) {
  if (valore && typeof valore === "object" && !Array.isArray(valore)) {
    if (typeof valore.__data === "string" && Object.keys(valore).length === 1) return Timestamp.fromDate(new Date(valore.__data));
    return Object.fromEntries(Object.entries(valore).map(([k, v]) => [k, daFile(v)]));
  }
  if (Array.isArray(valore)) return valore.map(daFile);
  return valore;
}

export async function preparaBackup(db, nomeSalone) {
  const [clienti, parrucchiere] = await Promise.all([
    getDocs(collection(db, "clienti")),
    getDocs(collection(db, "parrucchiere")),
  ]);
  const elenco = await Promise.all(clienti.docs.map(async (c) => {
    const schede = await getDocs(collection(db, "clienti", c.id, "schede"));
    return { id: c.id, ...inFile(c.data()), schede: schede.docs.map((s) => ({ id: s.id, ...inFile(s.data()) })) };
  }));
  return {
    app: "schede-colore",
    versione: VERSIONE,
    salone: nomeSalone,
    creatoIl: new Date().toISOString(),
    parrucchiere: parrucchiere.docs.map((p) => ({ id: p.id, ...inFile(p.data()) })),
    clienti: elenco,
  };
}

export async function creaBackup(db, nomeSalone) {
  const dati = await preparaBackup(db, nomeSalone);
  const giorno = dati.creatoIl.slice(0, 10);
  const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: `schede-colore-backup-${giorno}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { clienti: dati.clienti.length, schede: dati.clienti.reduce((n, c) => n + c.schede.length, 0) };
}

export async function leggiBackup(file) {
  let dati;
  try {
    dati = JSON.parse(await file.text());
  } catch {
    throw new Error("File non valido: non è un backup delle schede colore.");
  }
  if (dati?.app !== "schede-colore" || !Array.isArray(dati.clienti) || !Array.isArray(dati.parrucchiere))
    throw new Error("File non valido: non è un backup delle schede colore.");
  if (dati.versione > VERSIONE) throw new Error("File creato da una versione più nuova dell'app: aggiornala prima.");
  return dati;
}

export async function ripristinaBackup(db, dati) {
  const operazioni = [];
  for (const { id, ...p } of dati.parrucchiere) operazioni.push([doc(db, "parrucchiere", id), daFile(p)]);
  let schede = 0;
  for (const { id, schede: elencoSchede = [], ...c } of dati.clienti) {
    operazioni.push([doc(db, "clienti", id), daFile(c)]);
    for (const { id: idScheda, ...s } of elencoSchede) {
      operazioni.push([doc(db, "clienti", id, "schede", idScheda), daFile(s)]);
      schede++;
    }
  }
  for (let i = 0; i < operazioni.length; i += OPERAZIONI_PER_BLOCCO) {
    const batch = writeBatch(db);
    for (const [riferimento, valori] of operazioni.slice(i, i + OPERAZIONI_PER_BLOCCO)) batch.set(riferimento, valori);
    await batch.commit();
  }
  return { clienti: dati.clienti.length, schede };
}
