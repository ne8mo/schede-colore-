// Verifica le regole di sicurezza di Firestore sull'emulatore: npm test
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc } from "firebase/firestore";

const SALONE = "futuresun@staff.schede-colore.app";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-schede-colore",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "clienti/c1"), { nome: "Giulia", cognome: "Bianchi", telefono: "347", ricerca: "giulia" });
    await setDoc(doc(db, "clienti/c1/schede/s1"), { data: "2026-09-01", formula: "6.0 30g" });
    await setDoc(doc(db, "parrucchiere/p1"), { nome: "Sara", attiva: true });
    await setDoc(doc(db, "config/backup"), { ultimo: new Date() });
  });
});

const salone = () => env.authenticatedContext("uid-salone", { email: SALONE }).firestore();
const altro = (email) => env.authenticatedContext("uid-altro", email ? { email } : {}).firestore();
const anonimo = () => env.unauthenticatedContext().firestore();

describe("chi NON deve vedere i dati", () => {
  test("visitatore senza accesso", async () => {
    const db = anonimo();
    await assertFails(getDocs(collection(db, "clienti")));
    await assertFails(getDoc(doc(db, "clienti/c1/schede/s1")));
    await assertFails(getDocs(collection(db, "parrucchiere")));
    await assertFails(getDoc(doc(db, "config/backup")));
    await assertFails(setDoc(doc(db, "clienti/x"), { nome: "X" }));
  });

  test("qualsiasi altro account, anche con email simile", async () => {
    for (const email of ["altra@staff.schede-colore.app", "futuresun@altro.it", "FUTURESUN@staff.schede-colore.app", null]) {
      const db = altro(email);
      await assertFails(getDocs(collection(db, "clienti")));
      await assertFails(getDoc(doc(db, "clienti/c1/schede/s1")));
      await assertFails(setDoc(doc(db, "clienti/x"), { nome: "X" }));
      await assertFails(deleteDoc(doc(db, "clienti/c1")));
    }
  });

  test("collezioni non previste sono chiuse anche per il salone", async () => {
    await assertFails(setDoc(doc(salone(), "altro/x"), { a: 1 }));
    await assertFails(setDoc(doc(salone(), "config/setup"), { fatto: true }));
  });

  test("dati non validi vengono rifiutati", async () => {
    const db = salone();
    await assertFails(setDoc(doc(db, "clienti/c2"), { nome: "" }));
    await assertFails(setDoc(doc(db, "clienti/c2"), { nome: "A", note: "x".repeat(3001) }));
    await assertFails(setDoc(doc(db, "clienti/c1/schede/s2"), { formula: "manca la data" }));
    await assertFails(setDoc(doc(db, "config/backup"), { ultimo: new Date(), altro: "x" }));
  });
});

describe("foto delle schede cartacee", () => {
  const foto = { immagine: "data:image/jpeg;base64,AAAA", larghezza: 10, altezza: 10, nota: "", dataScheda: "" };

  test("solo il salone può vedere e caricare le foto", async () => {
    await assertSucceeds(setDoc(doc(salone(), "clienti/c1/foto/f1"), foto));
    await assertSucceeds(getDocs(collection(salone(), "clienti/c1/foto")));
    await assertFails(getDocs(collection(anonimo(), "clienti/c1/foto")));
    await assertFails(getDoc(doc(altro("altra@staff.schede-colore.app"), "clienti/c1/foto/f1")));
    await assertFails(setDoc(doc(altro("altra@staff.schede-colore.app"), "clienti/c1/foto/f2"), foto));
    await assertSucceeds(deleteDoc(doc(salone(), "clienti/c1/foto/f1")));
  });

  test("foto troppo grandi o senza immagine vengono rifiutate", async () => {
    await assertFails(setDoc(doc(salone(), "clienti/c1/foto/f3"), { ...foto, immagine: "x".repeat(1000001) }));
    await assertFails(setDoc(doc(salone(), "clienti/c1/foto/f4"), { nota: "senza immagine" }));
    await assertFails(setDoc(doc(salone(), "clienti/c1/foto/f5"), { ...foto, nota: "x".repeat(501) }));
  });
});

describe("l'account del salone può lavorare", () => {
  test("legge e scrive clienti, schede, parrucchiere e backup", async () => {
    const db = salone();
    await assertSucceeds(getDocs(collection(db, "clienti")));
    await assertSucceeds(setDoc(doc(db, "clienti/c2"), { nome: "Anna", parrucchiera: "Sara", ricerca: "anna" }));
    await assertSucceeds(getDocs(collection(db, "clienti/c1/schede")));
    await assertSucceeds(setDoc(doc(db, "clienti/c1/schede/s2"), { data: "2026-10-01", formula: "7.1" }));
    await assertSucceeds(deleteDoc(doc(db, "clienti/c1/schede/s2")));
    await assertSucceeds(setDoc(doc(db, "parrucchiere/p2"), { nome: "Marta", attiva: true }));
    await assertSucceeds(deleteDoc(doc(db, "parrucchiere/p2")));
    await assertSucceeds(setDoc(doc(db, "config/backup"), { ultimo: new Date() }));
    await assertSucceeds(deleteDoc(doc(db, "clienti/c2")));
  });
});
