import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, setPersistence, browserSessionPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, nomeSalone, minutiInattivita } from "./firebase-config.js?v=8";
import { creaBackup, leggiBackup, ripristinaBackup } from "./backup.js?v=8";
import { comprimiFoto, immagineSicura } from "./foto.js?v=8";

// Il nickname diventa un indirizzo email interno: Firebase richiede un'email, ma nessuna email viene mai inviata.
// Aumentare a ogni modifica (anche in index.html): costringe i browser a scaricare i file nuovi.
const VERSIONE = "8";
const DOMINIO_NICK = "staff.schede-colore.app";
const SERVIZI = ["Colore", "Ritocco radici", "Mèches", "Colpi di sole", "Balayage", "Tonalizzante / Gloss",
  "Decolorazione", "Trattamento", "Permanente", "Lisciante"];
const OSSIGENI = ["5 vol", "10 vol", "20 vol", "30 vol", "40 vol"];
const GIORNI_PROMEMORIA_BACKUP = 7;
const REGOLE_VECCHIE = "Firebase non permette le foto: le regole di sicurezza non sono aggiornate. "
  + "Vai in Impostazioni → Controllo permessi.";

const usaEmulatori = ["localhost", "127.0.0.1"].includes(location.hostname)
  && new URLSearchParams(location.search).has("emulatori");
const configurato = !String(firebaseConfig.apiKey).includes("INCOLLA");

const app = configurato ? initializeApp(firebaseConfig) : null;
const auth = app && getAuth(app);
const db = app && getFirestore(app);
if (usaEmulatori && app) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const stato = {
  utente: null,       // utente Firebase
  nick: null,         // nickname con cui si è entrati
  clienti: [],
  parrucchiere: [],
  backup: undefined,  // { ultimo, da } dell'ultimo backup scaricato (null = mai fatto)
  caricato: false,
  ascolti: [],        // listener da chiudere all'uscita
  ascoltoSchede: null,
  schede: [],
  foto: [],
  fotoRiferimento: null,   // foto della scheda cartacea da trascrivere
  schedaInModifica: null,  // id scheda o "nuova"
  baseScheda: null,        // scheda da cui copiare la formula
  messaggio: null,
};

const radice = document.getElementById("app");
document.title = `Schede colore · ${nomeSalone}`;

// ------------------------------------------------------------------ utilità

function h(tag, attributi = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "selected" || k === "disabled") el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of figli.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : String(f));
  }
  return el;
}

function campo(etichetta, input, aiuto) {
  return h("label", { class: "campo" }, h("span", {}, etichetta), input, aiuto && h("small", {}, aiuto));
}

function oggi() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dataBella(iso) {
  if (!iso) return "";
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(a, m - 1, g).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

// ordine alfabetico italiano: maiuscole/minuscole e accenti non contano
const confronta = new Intl.Collator("it", { sensitivity: "base", numeric: true }).compare;

function nomeCompleto(c) {
  return [c.nome, c.cognome].filter(Boolean).join(" ");
}

function chiaveOrdine(c, ordine) {
  return ordine === "cognome" && c.cognome ? `${c.cognome} ${c.nome}` : `${c.nome} ${c.cognome || ""}`;
}

function nomeInElenco(c, ordine) {
  return ordine === "cognome" && c.cognome ? `${c.cognome} ${c.nome}` : nomeCompleto(c);
}

function primaLettera(testo) {
  const l = (testo || "").trim().charAt(0).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return /[A-Z]/.test(l) ? l : "#";
}

function iniziali(c) {
  return `${(c.nome || "?").charAt(0)}${(c.cognome || "").charAt(0)}`.toUpperCase();
}

// non ridisegnare mentre qualcuno sta compilando un modulo (i dati arrivano in tempo reale)
function moduloAperto() {
  return Boolean(document.querySelector("[data-in-compilazione]"));
}

function chiaveRicerca(c) {
  return [c.nome, c.cognome, c.telefono].filter(Boolean).join(" ").toLowerCase();
}

function normalizzaNick(nick) {
  return (nick || "").trim().toLowerCase();
}

function emailDaNick(nick) {
  // si può scrivere il nickname (futuresun) oppure l'email completa usata in Firebase
  const n = normalizzaNick(nick);
  return n.includes("@") ? n : `${n}@${DOMINIO_NICK}`;
}

function erroreLeggibile(e) {
  const codice = e?.code || "";
  window.__errori?.push(`${codice || "errore"}: ${e?.message || e}`);
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(codice))
    return "Nickname o password non corretti.";
  if (codice === "auth/too-many-requests") return "Troppi tentativi. Riprova tra qualche minuto.";
  if (codice === "auth/email-already-in-use") return "Questo nickname è già usato.";
  if (codice === "auth/weak-password") return "La password deve avere almeno 6 caratteri.";
  if (codice === "auth/network-request-failed" || codice === "unavailable") return "Connessione assente. Controlla internet.";
  if (codice === "permission-denied") return "Non hai il permesso per questa operazione.";
  if (codice === "auth/requires-recent-login") return "Per sicurezza esci e rientra, poi riprova.";
  console.error(e);
  return "Qualcosa è andato storto. Riprova.";
}

function avvisa(testo, tipo = "ok") {
  stato.messaggio = { testo, tipo };
  const vecchio = document.querySelector(".toast");
  if (vecchio) vecchio.remove();
  const t = h("div", { class: `toast ${tipo}`, role: "status" }, testo);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

function vai(percorso) {
  if (location.hash === "#" + percorso) disegna();
  else location.hash = percorso;
}

function rotta() {
  const [, pagina = "", id = ""] = (location.hash.replace(/^#/, "") || "/").split("/");
  return { pagina, id };
}

// ------------------------------------------------------------------ accesso

function schermataNonConfigurata() {
  radice.replaceChildren(h("main", { class: "centro" }, h("div", { class: "pannello stretto" },
    h("h1", {}, "Manca la configurazione"),
    h("p", {}, "Apri il file ", h("code", {}, "docs/firebase-config.js"),
      " e incolla la configurazione del tuo progetto Firebase, come spiegato nella guida (README)."),
  )));
}

function schermataLogin() {
  const errore = h("p", { class: "errore", hidden: true });
  const mostraErrore = (t) => { errore.textContent = t; errore.hidden = false; };

  const nick = h("input", { required: true, autocomplete: "username", autocapitalize: "none", id: "nick" });
  const pw = h("input", { type: "password", required: true, autocomplete: "current-password", id: "password" });
  const bottone = h("button", { type: "submit", class: "bottone largo" }, "Entra");
  const form = h("form", {
    class: "pannello stretto",
    onsubmit: async (ev) => {
      ev.preventDefault();
      errore.hidden = true;
      bottone.disabled = true;
      try {
        await signInWithEmailAndPassword(auth, emailDaNick(nick.value), pw.value);
      } catch (e) {
        bottone.disabled = false;
        mostraErrore(erroreLeggibile(e));
      }
    },
  },
    h("div", { class: "marchio" }, nomeSalone),
    h("h1", {}, "Schede colore"),
    h("p", { class: "tenue" }, "Area riservata al personale."),
    campo("Nickname", nick, "Es. futuresun"),
    campo("Password", pw),
    errore, bottone,
  );
  const avviso = stato.messaggio?.tipo === "uscita" ? h("p", { class: "avviso" }, stato.messaggio.testo) : null;
  stato.messaggio = null;
  radice.replaceChildren(h("main", { class: "centro" }, h("div", {}, avviso, form)));
  nick.focus();
}

function schermataNonAutorizzato() {
  radice.replaceChildren(h("main", { class: "centro" }, h("div", { class: "pannello stretto" },
    h("h1", {}, "Accesso non autorizzato"),
    h("p", {}, "Questo account non è abilitato a vedere le schede."),
    h("button", { class: "bottone", onclick: () => signOut(auth) }, "Esci"),
  )));
}

function chiudiAscolti() {
  stato.ascolti.forEach((stop) => stop());
  stato.ascolti = [];
  if (stato.ascoltoSchede) stato.ascoltoSchede.stop();
  stato.ascoltoSchede = null;
}

async function avvia(utente) {
  // le regole di Firestore fanno entrare solo l'account del salone: se un altro account prova, viene respinto
  try {
    await getDoc(doc(db, "config", "backup"));
  } catch (e) {
    if (e?.code === "permission-denied") schermataNonAutorizzato();
    else avvisa(erroreLeggibile(e), "errore");
    return;
  }
  stato.utente = utente;
  stato.nick = (utente.email || "").split("@")[0];
  chiudiAscolti();
  let pronti = 0;
  const quandoPronto = () => {
    if (++pronti >= 2) stato.caricato = true;
    if (!moduloAperto()) disegna();
  };
  stato.ascolti.push(onSnapshot(collection(db, "clienti"), (snap) => {
    stato.clienti = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    quandoPronto();
  }, (e) => avvisa(erroreLeggibile(e), "errore")));
  stato.ascolti.push(onSnapshot(collection(db, "parrucchiere"), (snap) => {
    stato.parrucchiere = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => confronta(a.nome, b.nome));
    quandoPronto();
  }, (e) => avvisa(erroreLeggibile(e), "errore")));
  stato.ascolti.push(onSnapshot(doc(db, "config", "backup"), (snap) => {
    stato.backup = snap.exists() ? snap.data() : null;
    if (!moduloAperto()) disegna();
  }));
}

// uscita automatica dopo un periodo di inattività
let ultimaAttivita = Date.now();
["click", "keydown", "touchstart", "scroll"].forEach((ev) =>
  window.addEventListener(ev, () => { ultimaAttivita = Date.now(); }, { passive: true }));
setInterval(() => {
  if (stato.utente && Date.now() - ultimaAttivita > minutiInattivita * 60000) {
    stato.messaggio = { testo: "Sei stata disconnessa per inattività.", tipo: "uscita" };
    signOut(auth);
  }
}, 30000);

// ------------------------------------------------------------------ struttura

function barra() {
  const { pagina } = rotta();
  return h("header", { class: "barra" },
    h("a", { class: "marchio", href: "#/" }, nomeSalone, h("small", {}, "Schede colore")),
    h("nav", {},
      h("a", { href: "#/", class: pagina === "" || pagina === "cliente" ? "attivo" : "" }, "Clienti"),
      h("a", { href: "#/impostazioni", class: pagina === "impostazioni" ? "attivo" : "" }, "Impostazioni"),
      h("button", { class: "link", onclick: () => signOut(auth), title: "Esci" },
        h("span", { class: "chi" }, stato.nick), " · Esci"),
    ),
  );
}

function disegna() {
  if (!stato.utente) return;
  const { pagina, id } = rotta();
  let contenuto;
  if (!stato.caricato) contenuto = h("p", { class: "tenue centro-testo" }, "Caricamento…");
  else if (pagina === "cliente" && id === "nuova") contenuto = paginaModificaCliente(null);
  else if (pagina === "cliente" && id) contenuto = paginaCliente(id);
  else if (pagina === "modifica" && id) contenuto = paginaModificaCliente(id);
  else if (pagina === "impostazioni") contenuto = paginaImpostazioni();
  else contenuto = paginaClienti();
  const attivo = document.activeElement;
  const ricercaAttiva = attivo?.id === "cerca" ? { pos: attivo.selectionStart } : null;
  radice.replaceChildren(barra(), h("main", { class: "contenitore" }, contenuto));
  if (pagina === "impostazioni" && id) document.getElementById(id)?.scrollIntoView();
  if (ricercaAttiva) {
    const cerca = document.getElementById("cerca");
    cerca.focus();
    cerca.setSelectionRange(ricercaAttiva.pos, ricercaAttiva.pos);
  }
}

// ------------------------------------------------------------------ elenco clienti

function ordineSalvato() {
  try { return localStorage.getItem("ordine-clienti") === "nome" ? "nome" : "cognome"; } catch { return "cognome"; }
}

const filtri = { testo: "", parrucchiera: "", ordine: ordineSalvato() };

function paginaClienti() {
  const testo = filtri.testo.trim().toLowerCase();
  const cifre = testo.replace(/\D/g, "");
  const elenco = stato.clienti.filter((c) =>
    (!filtri.parrucchiera || c.parrucchiera === filtri.parrucchiera)
    && (!testo || c.ricerca?.includes(testo) || (cifre.length >= 3 && (c.telefono || "").replace(/\D/g, "").includes(cifre))))
    .sort((a, b) => confronta(chiaveOrdine(a, filtri.ordine), chiaveOrdine(b, filtri.ordine)));

  // righe dell'elenco con la lettera iniziale come separatore (A, B, C…)
  const righe = [];
  let letteraPrecedente = null;
  for (const c of elenco) {
    const lettera = primaLettera(chiaveOrdine(c, filtri.ordine));
    if (lettera !== letteraPrecedente) {
      righe.push(h("li", { class: "lettera", "aria-hidden": "true" }, lettera));
      letteraPrecedente = lettera;
    }
    righe.push(h("li", {},
      h("a", { href: `#/cliente/${c.id}` },
        h("span", { class: "avatar" }, iniziali(c)),
        h("span", { class: "dati" },
          h("strong", {}, nomeInElenco(c, filtri.ordine)),
          h("small", {}, [c.telefono, c.ultimaScheda && `ultima scheda ${dataBella(c.ultimaScheda)}`,
            c.numFoto > 0 && `📷 ${c.numFoto} foto`].filter(Boolean).join(" · ")),
        ),
        c.parrucchiera && h("span", { class: "chip" }, c.parrucchiera),
      )));
  }

  const parrucchiereUsate = [...new Set([
    ...stato.parrucchiere.map((p) => p.nome),
    ...stato.clienti.map((c) => c.parrucchiera).filter(Boolean),
  ])].sort(confronta);

  return h("div", {},
    promemoriaBackup(),
    h("div", { class: "testata-pagina" },
      h("h1", {}, "Clienti"),
      h("a", { class: "bottone", href: "#/cliente/nuova" }, "+ Nuova cliente"),
    ),
    h("div", { class: "filtri" },
      h("input", {
        id: "cerca", type: "search", placeholder: "Cerca per nome, cognome o telefono…", value: filtri.testo,
        autocomplete: "off",
        oninput: (e) => { filtri.testo = e.target.value; disegna(); },
      }),
      h("select", {
        "aria-label": "Parrucchiera",
        onchange: (e) => { filtri.parrucchiera = e.target.value; disegna(); },
      },
        h("option", { value: "" }, "Tutte le parrucchiere"),
        parrucchiereUsate.map((n) => h("option", { value: n, selected: filtri.parrucchiera === n }, n)),
      ),
    ),
    h("div", { class: "riga-conteggio" },
      h("p", { class: "tenue conteggio" },
        elenco.length === stato.clienti.length ? `${elenco.length} clienti` : `${elenco.length} di ${stato.clienti.length} clienti`),
      h("div", { class: "interruttore", role: "group", "aria-label": "Ordine alfabetico" },
        h("span", { class: "tenue" }, "A→Z per"),
        ["cognome", "nome"].map((o) => h("button", {
          type: "button", class: filtri.ordine === o ? "scelto" : "", "aria-pressed": String(filtri.ordine === o),
          onclick: () => {
            filtri.ordine = o;
            try { localStorage.setItem("ordine-clienti", o); } catch { /* non importa */ }
            disegna();
          },
        }, o)),
      ),
    ),
    elenco.length
      ? h("ul", { class: "lista" }, righe)
      : h("div", { class: "vuoto" },
        stato.clienti.length ? "Nessuna cliente trovata." : "Ancora nessuna cliente. Inizia con «+ Nuova cliente».",
      ),
  );
}

// ------------------------------------------------------------------ cliente: modifica

function selectParrucchiera(valore, extra = {}) {
  const nomi = stato.parrucchiere.filter((p) => p.attiva !== false).map((p) => p.nome);
  if (valore && !nomi.includes(valore)) nomi.push(valore);
  nomi.sort(confronta);
  return h("select", extra,
    h("option", { value: "" }, "— Nessuna —"),
    nomi.map((n) => h("option", { value: n, selected: n === valore }, n)),
  );
}

function paginaModificaCliente(id) {
  const c = id ? stato.clienti.find((x) => x.id === id) : {};
  if (!c) return h("p", { class: "vuoto" }, "Cliente non trovata.");
  const nome = h("input", { required: true, value: c.nome || "", maxlength: 80, autocomplete: "off" });
  const cognome = h("input", { value: c.cognome || "", maxlength: 80, autocomplete: "off" });
  const telefono = h("input", { type: "tel", value: c.telefono || "", maxlength: 30, autocomplete: "off" });
  const parrucchiera = selectParrucchiera(c.parrucchiera || "");
  const note = h("textarea", { maxlength: 3000, placeholder: "Allergie, cute sensibile, tipo di capello, preferenze…" }, c.note || "");
  const bottone = h("button", { type: "submit", class: "bottone" }, id ? "Salva" : "Crea cliente");
  const annulla = id ? `#/cliente/${id}` : "#/";

  const form = h("form", {
    class: "pannello",
    "data-in-compilazione": true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      bottone.disabled = true;
      const dati = {
        nome: nome.value.trim(), cognome: cognome.value.trim(), telefono: telefono.value.trim(),
        parrucchiera: parrucchiera.value, note: note.value.trim(), aggiornatoIl: serverTimestamp(),
      };
      dati.ricerca = chiaveRicerca(dati);
      try {
        if (id) {
          await updateDoc(doc(db, "clienti", id), dati);
          avvisa("Cliente aggiornata.");
          vai(`/cliente/${id}`);
        } else {
          const nuovo = await addDoc(collection(db, "clienti"), { ...dati, creatoIl: serverTimestamp(), ultimaScheda: null });
          avvisa("Cliente creata. Ora puoi aggiungere la prima scheda.");
          vai(`/cliente/${nuovo.id}`);
        }
      } catch (e) {
        bottone.disabled = false;
        avvisa(erroreLeggibile(e), "errore");
      }
    },
  },
    h("div", { class: "griglia-2" }, campo("Nome *", nome), campo("Cognome", cognome)),
    h("div", { class: "griglia-2" },
      campo("Telefono", telefono),
      campo("Parrucchiera che la segue", parrucchiera,
        stato.parrucchiere.length ? null : "Aggiungi i nomi delle parrucchiere da Impostazioni."),
    ),
    campo("Note fisse", note),
    h("div", { class: "azioni" }, bottone, h("a", { class: "bottone chiaro", href: annulla }, "Annulla")),
  );
  setTimeout(() => nome.focus());
  return h("div", {},
    h("p", { class: "indietro" }, h("a", { href: annulla }, "← Indietro")),
    h("h1", {}, id ? `Modifica ${nomeCompleto(c)}` : "Nuova cliente"),
    form,
  );
}

// ------------------------------------------------------------------ cliente: dettaglio e schede

function ascoltaSchede(clienteId) {
  if (stato.ascoltoSchede?.clienteId === clienteId) return;
  if (stato.ascoltoSchede) stato.ascoltoSchede.stop();
  stato.schede = null;
  stato.foto = null;
  const ridisegna = () => { if (rotta().id === clienteId && !moduloAperto()) disegna(); };
  const fermaSchede = onSnapshot(
    query(collection(db, "clienti", clienteId, "schede"), orderBy("data", "desc")),
    (snap) => { stato.schede = snap.docs.map((d) => ({ id: d.id, ...d.data() })); ridisegna(); },
    (e) => avvisa(erroreLeggibile(e), "errore"),
  );
  const fermaFoto = onSnapshot(
    query(collection(db, "clienti", clienteId, "foto"), orderBy("creatoIl", "desc")),
    (snap) => {
      stato.foto = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      aggiornaVisore();
      ridisegna();
    },
    (e) => avvisa(e?.code === "permission-denied" ? REGOLE_VECCHIE : erroreLeggibile(e), "errore"),
  );
  stato.ascoltoSchede = { clienteId, stop: () => { fermaSchede(); fermaFoto(); } };
}

function paginaCliente(id) {
  const c = stato.clienti.find((x) => x.id === id);
  if (!c) return h("div", { class: "vuoto" }, "Cliente non trovata. ", h("a", { href: "#/" }, "Torna all'elenco"));
  ascoltaSchede(id);

  const schede = stato.schede;
  const nuovaAperta = stato.schedaInModifica === "nuova";

  return h("div", {},
    h("p", { class: "indietro" }, h("a", { href: "#/" }, "← Tutte le clienti")),
    h("div", { class: "testata-cliente" },
      h("span", { class: "avatar grande" }, iniziali(c)),
      h("div", { class: "dati" },
        h("h1", {}, nomeCompleto(c)),
        h("p", {},
          c.telefono && h("a", { href: `tel:${c.telefono}` }, c.telefono),
          c.telefono && c.parrucchiera && " · ",
          c.parrucchiera && h("span", {}, "Segue: ", h("strong", {}, c.parrucchiera)),
        ),
      ),
      h("div", { class: "azioni" },
        h("a", { class: "bottone chiaro piccolo", href: `#/modifica/${id}` }, "Modifica dati"),
      ),
    ),
    c.note && h("div", { class: "note-cliente" }, h("strong", {}, "Note: "), c.note),

    h("div", { class: "testata-pagina" },
      h("h2", {}, "Schede colore"),
      h("div", { class: "azioni" },
        !nuovaAperta && h("button", {
          class: "bottone",
          onclick: () => { stato.schedaInModifica = "nuova"; stato.baseScheda = null; stato.fotoRiferimento = null; disegna(); },
        }, "+ Nuova scheda"),
        caricaFotoBottone(c),
      ),
    ),
    galleriaFoto(c),
    nuovaAperta && moduloScheda(c, null),
    schede === null
      ? h("p", { class: "tenue" }, "Caricamento…")
      : schede.length
        ? schede.map((s) => stato.schedaInModifica === s.id ? moduloScheda(c, s) : cartaScheda(c, s))
        : !nuovaAperta && !stato.foto?.length && h("div", { class: "vuoto" },
          "Nessuna scheda. Premi «+ Nuova scheda» per scriverla, oppure «📷 Carica foto» per fotografare una scheda di carta."),

    h("div", { class: "zona-pericolo" },
      h("button", {
        class: "bottone pericolo piccolo",
        onclick: () => eliminaCliente(c),
      }, "Elimina cliente, schede e foto"),
    ),
  );
}

function cartaScheda(c, s) {
  return h("article", { class: "scheda" },
    h("header", {},
      h("span", { class: "data" }, dataBella(s.data)),
      s.servizio && h("span", { class: "chip" }, s.servizio),
      s.parrucchiera && h("span", { class: "tenue" }, s.parrucchiera),
    ),
    s.formula && h("pre", { class: "formula" }, s.formula),
    (s.ossigeno || s.posa) && h("dl", { class: "dettagli" },
      s.ossigeno && [h("dt", {}, "Ossigeno"), h("dd", {}, s.ossigeno)],
      s.posa && [h("dt", {}, "Posa"), h("dd", {}, /^\d+$/.test(s.posa) ? `${s.posa} min` : s.posa)],
    ),
    s.note && h("p", { class: "note-scheda" }, s.note),
    h("footer", {},
      h("button", {
        class: "link", title: "Crea una nuova scheda partendo da questa formula",
        onclick: () => { stato.schedaInModifica = "nuova"; stato.baseScheda = s; disegna(); window.scrollTo({ top: 0, behavior: "smooth" }); },
      }, "Riusa questa formula"),
      h("button", { class: "link", onclick: () => { stato.schedaInModifica = s.id; disegna(); } }, "Modifica"),
      h("button", { class: "link rosso", onclick: () => eliminaScheda(c, s) }, "Elimina"),
    ),
  );
}

function moduloScheda(c, s) {
  const base = s || stato.baseScheda || {};
  const data = h("input", { type: "date", required: true, value: s ? s.data : (!s && stato.fotoRiferimento?.dataScheda) || oggi() });
  const parrucchiera = selectParrucchiera(s ? s.parrucchiera : (c.parrucchiera || ""));
  const servizio = h("input", { list: "elenco-servizi", value: base.servizio || "", maxlength: 80, placeholder: "Es. Ritocco radici" });
  const formula = h("textarea", {
    rows: 5, maxlength: 5000,
    placeholder: "Es.\nRadici: 6.0 30 g + 6.1 15 g\nLunghezze: gloss 8.13 + 9.0",
  }, base.formula || "");
  const ossigeno = h("input", { list: "elenco-ossigeni", value: base.ossigeno || "", maxlength: 60, placeholder: "Es. 20 vol 1:1,5" });
  const posa = h("input", { value: base.posa || "", maxlength: 30, inputmode: "numeric", placeholder: "Es. 35" });
  const note = h("textarea", { rows: 3, maxlength: 5000, placeholder: "Com'è venuto, cosa cambiare la prossima volta…" }, s ? (s.note || "") : "");
  const bottone = h("button", { type: "submit", class: "bottone" }, s ? "Salva modifiche" : "Salva scheda");
  const chiudi = () => { stato.schedaInModifica = null; stato.baseScheda = null; stato.fotoRiferimento = null; disegna(); };
  const riferimento = !s && stato.fotoRiferimento;

  const fotoRiferimento = riferimento && h("button", {
    type: "button", class: "riferimento", title: "Apri la foto a schermo intero",
    onclick: () => apriVisore(c, riferimento.id),
  }, h("img", { src: immagineSicura(riferimento.immagine), alt: "Scheda cartacea da trascrivere" }),
    h("span", {}, "Tocca per ingrandire"));
  const campi = [
    h("div", { class: "griglia-3" }, campo("Data", data), campo("Parrucchiera", parrucchiera), campo("Servizio", servizio)),
    campo("Formula colore e prodotti", formula, "Nuance, grammi, prodotti usati. Puoi andare a capo."),
    h("div", { class: "griglia-2" }, campo("Ossigeno", ossigeno), campo("Posa (minuti)", posa)),
    campo("Risultato e note", note),
    h("div", { class: "azioni" }, bottone, h("button", { type: "button", class: "bottone chiaro", onclick: chiudi }, "Annulla")),
  ];

  const form = h("form", {
    class: riferimento ? "pannello modulo-scheda largo" : "pannello modulo-scheda",
    "data-in-compilazione": true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      bottone.disabled = true;
      const dati = {
        data: data.value, parrucchiera: parrucchiera.value, servizio: servizio.value.trim(),
        formula: formula.value.trim(), ossigeno: ossigeno.value.trim(), posa: posa.value.trim(), note: note.value.trim(),
        aggiornatoIl: serverTimestamp(),
      };
      try {
        const batch = writeBatch(db);
        if (s) batch.update(doc(db, "clienti", c.id, "schede", s.id), dati);
        else batch.set(doc(collection(db, "clienti", c.id, "schede")), { ...dati, creatoIl: serverTimestamp() });
        const ultima = [dati.data, ...(stato.schede || []).filter((x) => x.id !== s?.id).map((x) => x.data)].sort().pop();
        batch.update(doc(db, "clienti", c.id), { ultimaScheda: ultima });
        await batch.commit();
        stato.schedaInModifica = null;
        stato.baseScheda = null;
        stato.fotoRiferimento = null;
        avvisa(s ? "Scheda aggiornata." : "Scheda salvata.");
        disegna();
      } catch (e) {
        bottone.disabled = false;
        avvisa(erroreLeggibile(e), "errore");
      }
    },
  },
    h("h3", {}, s ? "Modifica scheda" : riferimento ? "Trascrivi la scheda cartacea"
      : stato.baseScheda ? `Nuova scheda (dalla formula del ${dataBella(stato.baseScheda.data)})` : "Nuova scheda"),
    h("datalist", { id: "elenco-servizi" }, SERVIZI.map((v) => h("option", { value: v }))),
    h("datalist", { id: "elenco-ossigeni" }, OSSIGENI.map((v) => h("option", { value: v }))),
    riferimento ? h("div", { class: "trascrivi" }, fotoRiferimento, h("div", {}, campi)) : campi,
  );
  setTimeout(() => (s ? formula : servizio).focus());
  return form;
}

async function eliminaScheda(c, s) {
  if (!confirm(`Eliminare la scheda del ${dataBella(s.data)}?`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "clienti", c.id, "schede", s.id));
    const ultima = (stato.schede || []).filter((x) => x.id !== s.id).map((x) => x.data).sort().pop() || null;
    batch.update(doc(db, "clienti", c.id), { ultimaScheda: ultima });
    await batch.commit();
    avvisa("Scheda eliminata.");
  } catch (e) {
    avvisa(erroreLeggibile(e), "errore");
  }
}

async function eliminaCliente(c) {
  if (!confirm(`Eliminare ${nomeCompleto(c)} con tutte le sue schede e foto? L'operazione non si può annullare.`)) return;
  try {
    const [schede, foto] = await Promise.all([
      getDocs(collection(db, "clienti", c.id, "schede")),
      getDocs(collection(db, "clienti", c.id, "foto")),
    ]);
    const batch = writeBatch(db);
    schede.forEach((d) => batch.delete(d.ref));
    foto.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "clienti", c.id));
    await batch.commit();
    avvisa("Cliente eliminata.");
    vai("/");
  } catch (e) {
    avvisa(erroreLeggibile(e), "errore");
  }
}

// ------------------------------------------------------------------ foto delle schede cartacee

function caricaFotoBottone(c) {
  const input = h("input", { type: "file", accept: "image/*", multiple: true, class: "nascosto", id: "carica-foto" });
  input.addEventListener("change", async () => {
    const files = [...input.files];
    input.value = "";
    if (!files.length) return;
    let caricate = 0;
    for (const [i, file] of files.entries()) {
      avvisa(files.length > 1 ? `Carico la foto ${i + 1} di ${files.length}…` : "Carico la foto…");
      try {
        const { immagine, larghezza, altezza } = await comprimiFoto(file);
        const batch = writeBatch(db);
        batch.set(doc(collection(db, "clienti", c.id, "foto")), {
          immagine, larghezza, altezza, nota: "", dataScheda: "", creatoIl: serverTimestamp(),
        });
        batch.update(doc(db, "clienti", c.id), { numFoto: increment(1) });
        await batch.commit();
        caricate++;
      } catch (e) {
        avvisa(e?.code === "permission-denied" ? REGOLE_VECCHIE
          : e.message?.startsWith("«") || e.message?.startsWith("Non riesco") ? e.message : erroreLeggibile(e), "errore");
        return;
      }
    }
    avvisa(caricate === 1 ? "Foto caricata." : `${caricate} foto caricate.`);
  });
  return [input, h("label", { for: "carica-foto", class: "bottone chiaro", role: "button" }, "📷 Carica foto")];
}

function galleriaFoto(c) {
  if (!stato.foto?.length) return null;
  return h("section", { class: "galleria-sezione" },
    h("h3", {}, `Schede cartacee (${stato.foto.length} foto)`),
    h("div", { class: "galleria" }, stato.foto.map((f) => h("button", {
      type: "button", class: "miniatura", title: "Apri la foto", onclick: () => apriVisore(c, f.id),
    },
      h("img", { src: immagineSicura(f.immagine), alt: f.nota || "Scheda cartacea", loading: "lazy" }),
      (f.dataScheda || f.nota) && h("span", {}, [f.dataScheda && dataBella(f.dataScheda), f.nota].filter(Boolean).join(" · ")),
    ))),
  );
}

// visore a schermo intero: vive fuori dalla pagina, così non cancella una scheda che si sta scrivendo
let visore = null;

function chiudiVisore() {
  visore?.elemento.remove();
  visore = null;
  document.body.classList.remove("visore-aperto");
}

function aggiornaVisore() {
  if (!visore) return;
  const f = stato.foto?.find((x) => x.id === visore.fotoId);
  if (!f) chiudiVisore();
}

function apriVisore(c, fotoId) {
  chiudiVisore();
  const f = stato.foto?.find((x) => x.id === fotoId);
  if (!f) return;
  const img = h("img", { src: immagineSicura(f.immagine), alt: f.nota || "Scheda cartacea" });
  const area = h("div", { class: "visore-immagine", onclick: () => area.classList.toggle("zoom") }, img);
  const dataScheda = h("input", { type: "date", value: f.dataScheda || "", "aria-label": "Data della scheda" });
  const nota = h("input", { value: f.nota || "", maxlength: 500, placeholder: "Nota (es. colore 2019, retro della scheda…)", "aria-label": "Nota" });
  const elemento = h("div", { class: "visore", role: "dialog", "aria-modal": "true", "aria-label": "Foto della scheda" },
    h("div", { class: "visore-barra" },
      h("button", { class: "bottone chiaro piccolo", onclick: chiudiVisore }, "✕ Chiudi"),
      h("button", {
        class: "bottone piccolo",
        onclick: () => {
          stato.fotoRiferimento = { ...f, dataScheda: dataScheda.value || f.dataScheda };
          stato.schedaInModifica = "nuova";
          stato.baseScheda = null;
          chiudiVisore();
          disegna();
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
      }, "Trascrivi in una scheda"),
      h("button", {
        class: "bottone pericolo piccolo",
        onclick: async () => {
          if (!confirm("Eliminare questa foto?")) return;
          try {
            const batch = writeBatch(db);
            batch.delete(doc(db, "clienti", c.id, "foto", f.id));
            batch.update(doc(db, "clienti", c.id), { numFoto: increment(-1) });
            await batch.commit();
            chiudiVisore();
            avvisa("Foto eliminata.");
          } catch (e) {
            avvisa(erroreLeggibile(e), "errore");
          }
        },
      }, "Elimina"),
    ),
    h("form", {
      class: "visore-dati",
      onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          await updateDoc(doc(db, "clienti", c.id, "foto", f.id), { dataScheda: dataScheda.value, nota: nota.value.trim() });
          avvisa("Salvato.");
        } catch (e) {
          avvisa(erroreLeggibile(e), "errore");
        }
      },
    }, dataScheda, nota, h("button", { class: "bottone piccolo", type: "submit" }, "Salva")),
    area,
    h("p", { class: "visore-aiuto" }, "Tocca la foto per ingrandirla o rimpicciolirla."),
  );
  document.body.append(elemento);
  document.body.classList.add("visore-aperto");
  visore = { elemento, fotoId };
}

window.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiVisore(); });

// ------------------------------------------------------------------ backup

function giorniDallUltimoBackup() {
  const ultimo = stato.backup?.ultimo?.toDate?.();
  return ultimo ? Math.floor((Date.now() - ultimo.getTime()) / 86400000) : null;
}

function promemoriaBackup() {
  if (!stato.clienti.length || stato.backup === undefined) return null;
  const giorni = giorniDallUltimoBackup();
  if (giorni !== null && giorni < GIORNI_PROMEMORIA_BACKUP) return null;
  return h("div", { class: "promemoria" },
    h("span", {}, giorni === null ? "Non hai ancora scaricato nessun backup dei dati." : `L'ultimo backup è di ${giorni} giorni fa.`),
    h("a", { class: "bottone piccolo", href: "#/impostazioni/backup" }, "Fai il backup"),
  );
}

function sezioneBackup() {
  const giorni = giorniDallUltimoBackup();
  const ultimo = stato.backup?.ultimo?.toDate?.();
  const bottone = h("button", { class: "bottone", type: "button" }, "Scarica backup adesso");
  bottone.addEventListener("click", async () => {
    bottone.disabled = true;
    bottone.textContent = "Preparazione…";
    try {
      const { clienti, schede, foto } = await creaBackup(db, nomeSalone);
      await setDoc(doc(db, "config", "backup"), { ultimo: serverTimestamp() });
      avvisa(`Backup scaricato: ${clienti} clienti, ${schede} schede e ${foto} foto.`);
    } catch (e) {
      avvisa(erroreLeggibile(e), "errore");
    } finally {
      bottone.disabled = false;
      bottone.textContent = "Scarica backup adesso";
    }
  });

  const file = h("input", { type: "file", accept: ".json,application/json", class: "nascosto", id: "file-backup" });
  file.addEventListener("change", async () => {
    const scelto = file.files[0];
    file.value = "";
    if (!scelto) return;
    try {
      const dati = await leggiBackup(scelto);
      const conferma = `Ripristinare il backup del ${new Date(dati.creatoIl).toLocaleString("it-IT")}?\n\n`
        + `Contiene ${dati.clienti.length} clienti, ${dati.clienti.reduce((n, c) => n + (c.schede?.length || 0), 0)} schede `
        + `e ${dati.clienti.reduce((n, c) => n + (c.foto?.length || 0), 0)} foto.\n\n`
        + "Le clienti e le schede del backup vengono rimesse com'erano. Quelle aggiunte dopo il backup restano.";
      if (!confirm(conferma)) return;
      avvisa("Ripristino in corso…");
      const { clienti, schede, foto } = await ripristinaBackup(db, dati);
      avvisa(`Ripristino completato: ${clienti} clienti, ${schede} schede e ${foto} foto.`);
    } catch (e) {
      avvisa(e.message?.startsWith("File") ? e.message : erroreLeggibile(e), "errore");
    }
  });

  return h("section", { class: "pannello", id: "backup" },
    h("h2", {}, "Backup dei dati"),
    h("p", {},
      ultimo
        ? ["Ultimo backup: ", h("strong", {}, ultimo.toLocaleString("it-IT", { dateStyle: "long", timeStyle: "short" })),
giorni >= GIORNI_PROMEMORIA_BACKUP && h("span", { class: "rosso" }, " – da rifare")]
        : h("span", { class: "rosso" }, "Nessun backup scaricato finora."),
    ),
    h("p", { class: "tenue" },
      "Scarica una copia completa di clienti, schede, foto e parrucchiere in un file. Fallo almeno una volta a settimana ",
      "e conserva il file in un posto sicuro: una chiavetta o una cartella protetta da password. ",
      h("strong", {}, "Non mandarlo via WhatsApp o email"), ": contiene dati personali delle clienti."),
    h("div", { class: "azioni" },
      bottone,
      file,
      h("label", { for: "file-backup", class: "bottone chiaro" }, "Ripristina da un file…"),
    ),
  );
}

// ------------------------------------------------------------------ impostazioni

function paginaImpostazioni() {
  return h("div", {},
    h("h1", {}, "Impostazioni"),
    sezioneParrucchiere(),
    sezioneBackup(),
    sezioneControllo(),
    sezionePassword(),
    h("p", { class: "tenue versione" }, `Versione ${VERSIONE}`),
  );
}

function sezioneParrucchiere() {
  const nome = h("input", { required: true, maxlength: 60, placeholder: "Nome della parrucchiera" });
  return h("section", { class: "pannello" },
    h("h2", {}, "Parrucchiere"),
    h("p", { class: "tenue" }, "I nomi che puoi assegnare alle clienti e alle schede."),
    h("ul", { class: "righe" }, stato.parrucchiere.map((p) => h("li", { class: p.attiva === false ? "spenta" : "" },
      h("span", {}, p.nome, p.attiva === false && h("small", { class: "tenue" }, " (non più in salone)")),
      h("span", { class: "azioni" },
        h("button", {
          class: "link",
          onclick: async () => {
            const nuovo = prompt("Nuovo nome:", p.nome);
            if (nuovo && nuovo.trim()) await updateDoc(doc(db, "parrucchiere", p.id), { nome: nuovo.trim() }).catch((e) => avvisa(erroreLeggibile(e), "errore"));
          },
        }, "Rinomina"),
        h("button", {
          class: "link",
          onclick: () => updateDoc(doc(db, "parrucchiere", p.id), { nome: p.nome, attiva: p.attiva === false })
            .catch((e) => avvisa(erroreLeggibile(e), "errore")),
        }, p.attiva === false ? "Riattiva" : "Disattiva"),
        h("button", {
          class: "link rosso",
          onclick: async () => {
            if (confirm(`Eliminare ${p.nome} dall'elenco? Le schede già salvate mantengono il nome.`))
              await deleteDoc(doc(db, "parrucchiere", p.id)).catch((e) => avvisa(erroreLeggibile(e), "errore"));
          },
        }, "Elimina"),
      ),
    ))),
    h("form", {
      class: "in-linea",
      onsubmit: async (ev) => {
        ev.preventDefault();
        const n = nome.value.trim();
        if (stato.parrucchiere.some((p) => p.nome.toLowerCase() === n.toLowerCase())) return avvisa("C'è già una parrucchiera con questo nome.", "errore");
        try {
          await addDoc(collection(db, "parrucchiere"), { nome: n, attiva: true });
          avvisa(`${n} aggiunta.`);
        } catch (e) {
          avvisa(erroreLeggibile(e), "errore");
        }
      },
    }, nome, h("button", { class: "bottone", type: "submit" }, "Aggiungi")),
  );
}

// Prova cosa permettono davvero le regole di Firestore pubblicate, per capire subito cosa non va.
function sezioneControllo() {
  const esito = h("ul", { class: "righe controllo" });
  const bottone = h("button", { class: "bottone chiaro", type: "button" }, "Controlla permessi");
  const prove = [
    ["Accesso e lettura clienti", () => getDocs(query(collection(db, "clienti"), limit(1)))],
    ["Lettura delle foto", () => getDocs(query(collection(db, "clienti", "_controllo", "foto"), limit(1)))],
    ["Salvataggio di una foto", async () => {
      const prova = doc(db, "clienti", "_controllo", "foto", "prova");
      await setDoc(prova, { immagine: "data:image/jpeg;base64,", larghezza: 1, altezza: 1, nota: "", dataScheda: "" });
      await deleteDoc(prova);
    }],
    ["Data dell'ultimo backup", () => getDoc(doc(db, "config", "backup"))],
  ];
  bottone.addEventListener("click", async () => {
    bottone.disabled = true;
    esito.replaceChildren();
    let tuttoOk = true;
    for (const [nome, prova] of prove) {
      let riga;
      try {
        await prova();
        riga = h("li", {}, h("span", {}, nome), h("strong", { class: "verde" }, "✓ ok"));
      } catch (e) {
        tuttoOk = false;
        riga = h("li", {}, h("span", {}, nome),
          h("strong", { class: "rosso" }, e?.code === "permission-denied" ? "✗ non permesso" : `✗ ${e?.code || "errore"}`));
      }
      esito.append(riga);
    }
    esito.append(h("li", { class: "consiglio" }, tuttoOk
      ? "Tutto a posto: Firebase è configurato correttamente."
      : ["Le regole pubblicate in Firebase non sono quelle giuste. Copia il testo da ",
        h("a", { href: "https://raw.githubusercontent.com/ne8mo/schede-colore-/main/firestore.rules", target: "_blank", rel: "noopener" }, "questo link"),
        " e incollalo in Firebase → Firestore Database → Regole, sostituendo tutto, poi premi Pubblica. "
        + `Accesso attuale: ${stato.utente?.email || "?"}.`]));
    bottone.disabled = false;
  });
  return h("section", { class: "pannello" },
    h("h2", {}, "Controllo permessi"),
    h("p", { class: "tenue" }, "Se qualcosa dà «non hai il permesso», premi qui: l'app prova ogni operazione e ti dice cosa blocca Firebase."),
    h("div", { class: "azioni" }, bottone),
    esito,
  );
}

function sezionePassword() {
  const attuale = h("input", { type: "password", required: true, autocomplete: "current-password" });
  const nuova = h("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
  return h("section", { class: "pannello" },
    h("h2", {}, "Password del salone"),
    h("p", { class: "tenue" }, `Nickname: «${stato.nick}». La password è la stessa per tutte: `,
      "dopo averla cambiata comunicala alle colleghe di persona, non per messaggio."),
    h("form", {
      onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          await reauthenticateWithCredential(stato.utente, EmailAuthProvider.credential(stato.utente.email, attuale.value));
          await updatePassword(stato.utente, nuova.value);
          attuale.value = nuova.value = "";
          avvisa("Password cambiata.");
        } catch (e) {
          avvisa(erroreLeggibile(e), "errore");
        }
      },
    },
      h("div", { class: "griglia-2" }, campo("Password attuale", attuale), campo("Nuova password", nuova, "Almeno 8 caratteri.")),
      h("div", { class: "azioni" }, h("button", { class: "bottone", type: "submit" }, "Cambia password")),
    ),
  );
}

// ------------------------------------------------------------------ avvio

window.addEventListener("hashchange", () => {
  chiudiVisore();
  stato.fotoRiferimento = null;
  stato.schedaInModifica = null;
  stato.baseScheda = null;
  window.scrollTo(0, 0);
  disegna();
});

if (!configurato) {
  schermataNonConfigurata();
} else {
  await setPersistence(auth, browserSessionPersistence);
  onAuthStateChanged(auth, async (utente) => {
    if (utente) {
      ultimaAttivita = Date.now();
      await avvia(utente);
    } else {
      chiudiVisore();
      chiudiAscolti();
      Object.assign(stato, { utente: null, nick: null, clienti: [], parrucchiere: [], backup: undefined, caricato: false, schede: [] });
      schermataLogin();
    }
  });
}
