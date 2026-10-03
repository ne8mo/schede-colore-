import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, setPersistence, browserSessionPersistence, inMemoryPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, nomeSalone, minutiInattivita } from "./firebase-config.js";

// Il nickname diventa un indirizzo email interno: Firebase richiede un'email, ma nessuna email viene mai inviata.
const DOMINIO_NICK = "staff.schede-colore.app";
const SERVIZI = ["Colore", "Ritocco radici", "Mèches", "Colpi di sole", "Balayage", "Tonalizzante / Gloss",
  "Decolorazione", "Trattamento", "Permanente", "Lisciante"];
const OSSIGENI = ["5 vol", "10 vol", "20 vol", "30 vol", "40 vol"];

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
  profilo: null,      // documento staff
  clienti: [],
  parrucchiere: [],
  staff: [],
  caricato: false,
  ascolti: [],        // listener da chiudere all'uscita
  ascoltoSchede: null,
  schede: [],
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

function nomeCompleto(c) {
  return [c.nome, c.cognome].filter(Boolean).join(" ");
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
  return `${normalizzaNick(nick)}@${DOMINIO_NICK}`;
}

function erroreLeggibile(e) {
  const codice = e?.code || "";
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

async function setupFatto() {
  const s = await getDoc(doc(db, "config", "setup"));
  return s.exists();
}

function schermataNonConfigurata() {
  radice.replaceChildren(h("main", { class: "centro" }, h("div", { class: "pannello stretto" },
    h("h1", {}, "Manca la configurazione"),
    h("p", {}, "Apri il file ", h("code", {}, "public/firebase-config.js"),
      " e incolla la configurazione del tuo progetto Firebase, come spiegato nella guida (README)."),
  )));
}

function schermataLogin(primoAvvio) {
  const errore = h("p", { class: "errore", hidden: true });
  const mostraErrore = (t) => { errore.textContent = t; errore.hidden = false; };

  if (primoAvvio) {
    const nome = h("input", { required: true, autocomplete: "name", placeholder: "Es. Giulia" });
    const nick = h("input", { required: true, autocomplete: "username", autocapitalize: "none", placeholder: "Es. giulia" });
    const pw = h("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
    const pw2 = h("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
    const bottone = h("button", { type: "submit", class: "bottone largo" }, "Crea account amministratore");
    const form = h("form", {
      class: "pannello stretto",
      onsubmit: async (ev) => {
        ev.preventDefault();
        errore.hidden = true;
        if (!/^[a-z0-9._-]{3,30}$/.test(normalizzaNick(nick.value)))
          return mostraErrore("Il nickname può contenere solo lettere, numeri, punto, trattino (da 3 a 30 caratteri).");
        if (pw.value !== pw2.value) return mostraErrore("Le due password non coincidono.");
        bottone.disabled = true;
        try {
          const cred = await createUserWithEmailAndPassword(auth, emailDaNick(nick.value), pw.value);
          const batch = writeBatch(db);
          batch.set(doc(db, "staff", cred.user.uid), {
            nome: nome.value.trim(), nickname: normalizzaNick(nick.value), ruolo: "admin", attivo: true,
            creatoIl: serverTimestamp(),
          });
          batch.set(doc(db, "config", "setup"), { fatto: true, quando: serverTimestamp() });
          await batch.commit();
          avvisa("Benvenuta! Il tuo account amministratore è pronto.");
          avvia(cred.user);
        } catch (e) {
          bottone.disabled = false;
          mostraErrore(erroreLeggibile(e));
        }
      },
    },
      h("div", { class: "marchio" }, nomeSalone),
      h("h1", {}, "Primo avvio"),
      h("p", { class: "tenue" }, "Crea l'account dell'amministratore. Dopo potrai aggiungere gli accessi per le altre persone dalle Impostazioni."),
      campo("Il tuo nome", nome),
      campo("Nickname (per entrare)", nick),
      campo("Password", pw, "Almeno 8 caratteri."),
      campo("Ripeti la password", pw2),
      errore, bottone,
    );
    radice.replaceChildren(h("main", { class: "centro" }, form));
    nome.focus();
    return;
  }

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
    campo("Nickname", nick),
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
    h("p", {}, "Questo account non è abilitato o è stato disattivato. Chiedi all'amministratore."),
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
  const profilo = await getDoc(doc(db, "staff", utente.uid)).catch(() => null);
  if (!profilo?.exists() || !profilo.data().attivo) {
    schermataNonAutorizzato();
    return;
  }
  stato.utente = utente;
  stato.profilo = { id: utente.uid, ...profilo.data() };
  chiudiAscolti();
  let pronti = 0;
  const quandoPronto = () => {
    if (++pronti >= 2) stato.caricato = true;
    if (!moduloAperto()) disegna();
  };
  stato.ascolti.push(onSnapshot(query(collection(db, "clienti"), orderBy("ricerca")), (snap) => {
    stato.clienti = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    quandoPronto();
  }, (e) => avvisa(erroreLeggibile(e), "errore")));
  stato.ascolti.push(onSnapshot(query(collection(db, "parrucchiere"), orderBy("nome")), (snap) => {
    stato.parrucchiere = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    quandoPronto();
  }, (e) => avvisa(erroreLeggibile(e), "errore")));
  if (stato.profilo.ruolo === "admin") {
    stato.ascolti.push(onSnapshot(collection(db, "staff"), (snap) => {
      stato.staff = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
      if (rotta().pagina === "impostazioni") disegna();
    }));
  }
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
        h("span", { class: "chi" }, stato.profilo.nome || stato.profilo.nickname), " · Esci"),
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
  if (ricercaAttiva) {
    const cerca = document.getElementById("cerca");
    cerca.focus();
    cerca.setSelectionRange(ricercaAttiva.pos, ricercaAttiva.pos);
  }
}

// ------------------------------------------------------------------ elenco clienti

const filtri = { testo: "", parrucchiera: "" };

function paginaClienti() {
  const testo = filtri.testo.trim().toLowerCase();
  const cifre = testo.replace(/\D/g, "");
  const elenco = stato.clienti.filter((c) =>
    (!filtri.parrucchiera || c.parrucchiera === filtri.parrucchiera)
    && (!testo || c.ricerca?.includes(testo) || (cifre.length >= 3 && (c.telefono || "").replace(/\D/g, "").includes(cifre))));

  const parrucchiereUsate = [...new Set([
    ...stato.parrucchiere.map((p) => p.nome),
    ...stato.clienti.map((c) => c.parrucchiera).filter(Boolean),
  ])].sort();

  return h("div", {},
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
    h("p", { class: "tenue conteggio" },
      elenco.length === stato.clienti.length ? `${elenco.length} clienti` : `${elenco.length} di ${stato.clienti.length} clienti`),
    elenco.length
      ? h("ul", { class: "lista" }, elenco.map((c) => h("li", {},
        h("a", { href: `#/cliente/${c.id}` },
          h("span", { class: "avatar" }, iniziali(c)),
          h("span", { class: "dati" },
            h("strong", {}, nomeCompleto(c)),
            h("small", {}, [c.telefono, c.ultimaScheda && `ultima scheda ${dataBella(c.ultimaScheda)}`].filter(Boolean).join(" · ")),
          ),
          c.parrucchiera && h("span", { class: "chip" }, c.parrucchiera),
        ))))
      : h("div", { class: "vuoto" },
        stato.clienti.length ? "Nessuna cliente trovata." : "Ancora nessuna cliente. Inizia con «+ Nuova cliente».",
      ),
  );
}

// ------------------------------------------------------------------ cliente: modifica

function selectParrucchiera(valore, extra = {}) {
  const nomi = stato.parrucchiere.filter((p) => p.attiva !== false).map((p) => p.nome);
  if (valore && !nomi.includes(valore)) nomi.push(valore);
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
  const stop = onSnapshot(
    query(collection(db, "clienti", clienteId, "schede"), orderBy("data", "desc")),
    (snap) => {
      stato.schede = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (rotta().id === clienteId && !moduloAperto()) disegna();
    },
    (e) => avvisa(erroreLeggibile(e), "errore"),
  );
  stato.ascoltoSchede = { clienteId, stop };
}

function paginaCliente(id) {
  const c = stato.clienti.find((x) => x.id === id);
  if (!c) return h("div", { class: "vuoto" }, "Cliente non trovata. ", h("a", { href: "#/" }, "Torna all'elenco"));
  ascoltaSchede(id);
  const admin = stato.profilo.ruolo === "admin";

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
      !nuovaAperta && h("button", {
        class: "bottone",
        onclick: () => { stato.schedaInModifica = "nuova"; stato.baseScheda = null; disegna(); },
      }, "+ Nuova scheda"),
    ),
    nuovaAperta && moduloScheda(c, null),
    schede === null
      ? h("p", { class: "tenue" }, "Caricamento…")
      : schede.length
        ? schede.map((s) => stato.schedaInModifica === s.id ? moduloScheda(c, s) : cartaScheda(c, s))
        : !nuovaAperta && h("div", { class: "vuoto" }, "Nessuna scheda. Premi «+ Nuova scheda» per registrare il primo colore."),

    admin && h("div", { class: "zona-pericolo" },
      h("button", {
        class: "bottone pericolo piccolo",
        onclick: () => eliminaCliente(c),
      }, "Elimina cliente e tutte le sue schede"),
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
  const data = h("input", { type: "date", required: true, value: s ? s.data : oggi() });
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
  const chiudi = () => { stato.schedaInModifica = null; stato.baseScheda = null; disegna(); };

  const form = h("form", {
    class: "pannello modulo-scheda",
    "data-in-compilazione": true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      bottone.disabled = true;
      const dati = {
        data: data.value, parrucchiera: parrucchiera.value, servizio: servizio.value.trim(),
        formula: formula.value.trim(), ossigeno: ossigeno.value.trim(), posa: posa.value.trim(), note: note.value.trim(),
        aggiornatoIl: serverTimestamp(), aggiornatoDa: stato.profilo.nome || stato.profilo.nickname,
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
        avvisa(s ? "Scheda aggiornata." : "Scheda salvata.");
        disegna();
      } catch (e) {
        bottone.disabled = false;
        avvisa(erroreLeggibile(e), "errore");
      }
    },
  },
    h("h3", {}, s ? "Modifica scheda" : stato.baseScheda ? `Nuova scheda (dalla formula del ${dataBella(stato.baseScheda.data)})` : "Nuova scheda"),
    h("datalist", { id: "elenco-servizi" }, SERVIZI.map((v) => h("option", { value: v }))),
    h("datalist", { id: "elenco-ossigeni" }, OSSIGENI.map((v) => h("option", { value: v }))),
    h("div", { class: "griglia-3" }, campo("Data", data), campo("Parrucchiera", parrucchiera), campo("Servizio", servizio)),
    campo("Formula colore e prodotti", formula, "Nuance, grammi, prodotti usati. Puoi andare a capo."),
    h("div", { class: "griglia-2" }, campo("Ossigeno", ossigeno), campo("Posa (minuti)", posa)),
    campo("Risultato e note", note),
    h("div", { class: "azioni" }, bottone, h("button", { type: "button", class: "bottone chiaro", onclick: chiudi }, "Annulla")),
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
  if (!confirm(`Eliminare ${nomeCompleto(c)} e tutte le sue schede? L'operazione non si può annullare.`)) return;
  try {
    const schede = await getDocs(collection(db, "clienti", c.id, "schede"));
    const batch = writeBatch(db);
    schede.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "clienti", c.id));
    await batch.commit();
    avvisa("Cliente eliminata.");
    vai("/");
  } catch (e) {
    avvisa(erroreLeggibile(e), "errore");
  }
}

// ------------------------------------------------------------------ impostazioni

function paginaImpostazioni() {
  const admin = stato.profilo.ruolo === "admin";
  return h("div", {},
    h("h1", {}, "Impostazioni"),
    sezioneParrucchiere(admin),
    admin && sezioneAccessi(),
    sezionePassword(),
  );
}

function sezioneParrucchiere(admin) {
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
        admin && h("button", {
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

function sezioneAccessi() {
  const nome = h("input", { required: true, maxlength: 60, placeholder: "Es. Sara" });
  const nick = h("input", { required: true, autocapitalize: "none", autocomplete: "off", placeholder: "Es. sara" });
  const pw = h("input", { type: "text", required: true, minlength: 8, autocomplete: "off", placeholder: "Almeno 8 caratteri" });
  const ruolo = h("select", {}, h("option", { value: "staff" }, "Personale"), h("option", { value: "admin" }, "Amministratore"));
  const bottone = h("button", { class: "bottone", type: "submit" }, "Crea accesso");

  return h("section", { class: "pannello" },
    h("h2", {}, "Accessi"),
    h("p", { class: "tenue" },
      "Solo le persone in questo elenco possono entrare. «Personale» vede e modifica clienti e schede; ",
      "«Amministratore» può anche gestire gli accessi ed eliminare le clienti."),
    h("ul", { class: "righe" }, stato.staff.map((u) => h("li", { class: u.attivo ? "" : "spenta" },
      h("span", {}, h("strong", {}, u.nome || u.nickname), h("small", { class: "tenue" }, ` @${u.nickname} · ${u.ruolo === "admin" ? "Amministratore" : "Personale"}`),
        !u.attivo && h("small", { class: "tenue" }, " · disattivato")),
      u.id !== stato.profilo.id
        ? h("span", { class: "azioni" },
          h("button", {
            class: "link",
            onclick: () => updateDoc(doc(db, "staff", u.id), { ruolo: u.ruolo === "admin" ? "staff" : "admin" })
              .catch((e) => avvisa(erroreLeggibile(e), "errore")),
          }, u.ruolo === "admin" ? "Rendi personale" : "Rendi amministratore"),
          h("button", {
            class: u.attivo ? "link rosso" : "link",
            onclick: () => updateDoc(doc(db, "staff", u.id), { attivo: !u.attivo })
              .catch((e) => avvisa(erroreLeggibile(e), "errore")),
          }, u.attivo ? "Blocca accesso" : "Riattiva"),
        )
        : h("small", { class: "tenue" }, "sei tu"),
    ))),
    h("h3", {}, "Nuovo accesso"),
    h("form", {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const n = normalizzaNick(nick.value);
        if (!/^[a-z0-9._-]{3,30}$/.test(n))
          return avvisa("Il nickname può contenere solo lettere, numeri, punto e trattino (3-30 caratteri).", "errore");
        bottone.disabled = true;
        // si usa una seconda istanza di Firebase per creare l'account senza far uscire l'amministratore
        const secondaria = initializeApp(firebaseConfig, `creazione-${Date.now()}`);
        try {
          const auth2 = getAuth(secondaria);
          if (usaEmulatori) connectAuthEmulator(auth2, "http://127.0.0.1:9099", { disableWarnings: true });
          await setPersistence(auth2, inMemoryPersistence);
          const cred = await createUserWithEmailAndPassword(auth2, emailDaNick(n), pw.value);
          await setDoc(doc(db, "staff", cred.user.uid), {
            nome: nome.value.trim(), nickname: n, ruolo: ruolo.value, attivo: true, creatoIl: serverTimestamp(),
          });
          await signOut(auth2);
          avvisa(`Accesso creato: nickname «${n}». Comunica la password di persona.`);
          nome.value = nick.value = pw.value = "";
        } catch (e) {
          avvisa(erroreLeggibile(e), "errore");
        } finally {
          bottone.disabled = false;
          deleteApp(secondaria);
        }
      },
    },
      h("div", { class: "griglia-2" }, campo("Nome", nome), campo("Nickname", nick)),
      h("div", { class: "griglia-2" }, campo("Password iniziale", pw), campo("Ruolo", ruolo)),
      h("div", { class: "azioni" }, bottone),
    ),
  );
}

function sezionePassword() {
  const attuale = h("input", { type: "password", required: true, autocomplete: "current-password" });
  const nuova = h("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
  return h("section", { class: "pannello" },
    h("h2", {}, "La mia password"),
    h("p", { class: "tenue" }, `Sei entrata come «${stato.profilo.nickname}».`),
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
      chiudiAscolti();
      Object.assign(stato, { utente: null, profilo: null, clienti: [], parrucchiere: [], staff: [], caricato: false, schede: [] });
      let primo = false;
      try { primo = !(await setupFatto()); } catch (e) { /* offline: mostra il login normale */ }
      schermataLogin(primo);
    }
  });
}
