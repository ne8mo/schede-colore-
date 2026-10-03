// Verifica le regole di sicurezza di Firestore sull'emulatore: npm test
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, writeBatch } from "firebase/firestore";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-schede-colore",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(() => env.cleanup());

async function preparaDati() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/setup"), { fatto: true });
    await setDoc(doc(db, "staff/admin1"), { nome: "Titolare", nickname: "titolare", ruolo: "admin", attivo: true });
    await setDoc(doc(db, "staff/sara"), { nome: "Sara", nickname: "sara", ruolo: "staff", attivo: true });
    await setDoc(doc(db, "staff/ex"), { nome: "Ex", nickname: "ex", ruolo: "staff", attivo: false });
    await setDoc(doc(db, "clienti/c1"), { nome: "Giulia", cognome: "Bianchi", telefono: "347", ricerca: "giulia" });
    await setDoc(doc(db, "clienti/c1/schede/s1"), { data: "2026-09-01", formula: "6.0 30g" });
    await setDoc(doc(db, "parrucchiere/p1"), { nome: "Sara", attiva: true });
  });
}

const come = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe("chi NON deve vedere i dati", () => {
  beforeEach(async () => { await env.clearFirestore(); await preparaDati(); });

  test("visitatore non loggato: niente clienti né schede", async () => {
    await assertFails(getDocs(collection(come(null), "clienti")));
    await assertFails(getDoc(doc(come(null), "clienti/c1/schede/s1")));
    await assertFails(getDocs(collection(come(null), "staff")));
  });

  test("account creato da sé (non nello staff): niente dati", async () => {
    const db = come("intruso");
    await assertFails(getDocs(collection(db, "clienti")));
    await assertFails(getDoc(doc(db, "clienti/c1")));
    await assertFails(setDoc(doc(db, "clienti/nuovo"), { nome: "X" }));
    await assertFails(getDocs(collection(db, "parrucchiere")));
  });

  test("account creato da sé non può nominarsi amministratore dopo il primo avvio", async () => {
    const db = come("intruso");
    await assertFails(setDoc(doc(db, "staff/intruso"), { nome: "X", nickname: "x", ruolo: "admin", attivo: true }));
    await assertFails(setDoc(doc(db, "config/setup"), { fatto: true }));
  });

  test("accesso bloccato: niente più dati", async () => {
    await assertFails(getDocs(collection(come("ex"), "clienti")));
  });

  test("il personale non può gestire gli accessi né promuoversi", async () => {
    const db = come("sara");
    await assertFails(setDoc(doc(db, "staff/amica"), { nome: "A", nickname: "a", ruolo: "staff", attivo: true }));
    await assertFails(updateDoc(doc(db, "staff/sara"), { ruolo: "admin" }));
    await assertFails(updateDoc(doc(db, "staff/ex"), { attivo: true }));
  });

  test("il personale non può eliminare una cliente", async () => {
    await assertFails(deleteDoc(doc(come("sara"), "clienti/c1")));
  });

  test("dati non validi vengono rifiutati", async () => {
    const db = come("sara");
    await assertFails(setDoc(doc(db, "clienti/c2"), { nome: "" }));
    await assertFails(setDoc(doc(db, "clienti/c2"), { nome: "A", note: "x".repeat(3001) }));
    await assertFails(setDoc(doc(db, "clienti/c1/schede/s2"), { formula: "manca la data" }));
  });

  test("collezioni non previste sono chiuse", async () => {
    await assertFails(setDoc(doc(come("admin1"), "altro/x"), { a: 1 }));
  });
});

describe("chi deve poter lavorare", () => {
  beforeEach(async () => { await env.clearFirestore(); await preparaDati(); });

  test("il personale legge e scrive clienti, schede e parrucchiere", async () => {
    const db = come("sara");
    await assertSucceeds(getDocs(collection(db, "clienti")));
    await assertSucceeds(setDoc(doc(db, "clienti/c2"), { nome: "Anna", parrucchiera: "Sara", ricerca: "anna" }));
    await assertSucceeds(getDocs(collection(db, "clienti/c1/schede")));
    await assertSucceeds(setDoc(doc(db, "clienti/c1/schede/s2"), { data: "2026-10-01", formula: "7.1" }));
    await assertSucceeds(deleteDoc(doc(db, "clienti/c1/schede/s2")));
    await assertSucceeds(setDoc(doc(db, "parrucchiere/p2"), { nome: "Marta", attiva: true }));
  });

  test("l'amministratore gestisce gli accessi ed elimina clienti", async () => {
    const db = come("admin1");
    await assertSucceeds(setDoc(doc(db, "staff/nuova"), { nome: "N", nickname: "n", ruolo: "staff", attivo: true }));
    await assertSucceeds(updateDoc(doc(db, "staff/sara"), { attivo: false }));
    await assertSucceeds(deleteDoc(doc(db, "clienti/c1")));
  });

  test("l'amministratore non può bloccare se stesso", async () => {
    await assertFails(updateDoc(doc(come("admin1"), "staff/admin1"), { attivo: false }));
    await assertFails(deleteDoc(doc(come("admin1"), "staff/admin1")));
  });
});

describe("primo avvio", () => {
  beforeEach(() => env.clearFirestore());

  test("il primo utente diventa amministratore, una volta sola", async () => {
    const titolare = come("titolare");
    const primo = writeBatch(titolare);
    primo.set(doc(titolare, "staff/titolare"), { nome: "T", nickname: "t", ruolo: "admin", attivo: true });
    primo.set(doc(titolare, "config/setup"), { fatto: true });
    await assertSucceeds(primo.commit());
    await assertSucceeds(getDocs(collection(titolare, "clienti")));

    const altro = come("altro");
    const secondo = writeBatch(altro);
    secondo.set(doc(altro, "staff/altro"), { nome: "A", nickname: "a", ruolo: "admin", attivo: true });
    secondo.set(doc(altro, "config/setup"), { fatto: true });
    await assertFails(secondo.commit());
    await assertFails(getDocs(collection(altro, "clienti")));
  });

  test("non si può creare lo staff senza segnare il primo avvio", async () => {
    await assertFails(setDoc(doc(come("x"), "staff/x"), { nome: "X", nickname: "x", ruolo: "admin", attivo: true }));
  });
});
