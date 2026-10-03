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
