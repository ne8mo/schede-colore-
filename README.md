# Schede colore – Future'Sun

Gestionale delle schede colore del salone: clienti, formule, ossigeno, posa, note e parrucchiera che segue la cliente.

Si entra con **un solo nickname e una sola password, uguali per tutto il salone**.
Funziona da computer, tablet e telefono. I dati stanno su **Firebase** (Google), in Europa, e possono
leggerli e modificarli **solo** con quell'accesso.

- App: **https://ne8mo.github.io/schede-colore-/**
- Nickname: **`futuresun`**
- Progetto Firebase: `gestionale-schede-tecniche`

---

## Come funziona la sicurezza

- **Un solo accesso per tutte.** Il nickname `futuresun` per Firebase è l'indirizzo interno
  `futuresun@staff.schede-colore.app`. Non è un indirizzo vero e non riceve posta.
- **Il controllo lo fa il server di Firebase**, non la pagina. Le regole ([`firestore.rules`](firestore.rules))
  rispondono solo a quell'account: chi non ha fatto l'accesso, o entra con un altro account, non vede nulla.
  Non si aggira modificando la pagina.
- **Nessuno può creare altri accessi dall'esterno**, perché la registrazione è chiusa nella console di Firebase (passo 5).
- **Uscita automatica** dopo 20 minuti senza usare l'app, o chiudendo il browser.
  I minuti si cambiano in `public/firebase-config.js`.
- **Il sito non compare su Google** (`noindex`).
- **Se una dipendente lascia il salone**, cambia la password (*Impostazioni → Password del salone*) e
  comunicala di persona alle altre.

Le regole sono verificate da prove automatiche (`npm test`). Le prove controllano che visitatori e qualsiasi
altro account, anche con nomi simili, non possano leggere né scrivere nulla.

---

## Messa online (una volta sola, tutto dal browser)

### 1. Progetto Firebase
<https://console.firebase.google.com> → **Crea un progetto** → Google Analytics disattivato.

### 2. Login
**Authentication → Inizia → Metodo di accesso → Email/password**: attiva solo la prima voce e salva.

### 3. Database
**Firestore Database → Crea database**:
- edizione **Standard**;
- località **`europe-west8 (Milano)`**;
- **modalità di produzione**.

### 4. Collega l'app
**Impostazioni progetto → Le tue app → `</>`**, registra l'app e copia i valori di `firebaseConfig`
in [`public/firebase-config.js`](public/firebase-config.js). *(Già fatto per `gestionale-schede-tecniche`.)*

### 5. Crea l'accesso del salone e chiudi la registrazione
1. **Authentication → Utenti → Aggiungi utente**:
   - Email: **`futuresun@staff.schede-colore.app`**
   - Password: quella che userete tutte (almeno 8 caratteri, non banale).
2. **Authentication → Impostazioni → Azioni utente**: togli la spunta da **Abilita creazione (registrazione)**
   e salva. Così nessun altro può crearsi un accesso.

### 6. Regole di sicurezza
Apri [`firestore.rules`](firestore.rules) su GitHub, copia tutto il testo, poi in **Firestore Database → Regole**
cancella quello che c'è, incolla e premi **Pubblica**.

### 7. Pubblica l'app con GitHub Pages
1. Nel repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Scheda **Actions → «Pubblica su GitHub Pages» → Run workflow** (solo la prima volta: dopo si aggiorna da sola
   a ogni modifica del repository).
3. In Firebase: **Authentication → Impostazioni → Domini autorizzati → Aggiungi dominio** → `ne8mo.github.io`.

### 8. Entra
Apri **https://ne8mo.github.io/schede-colore-/**, entra con `futuresun` e la password, poi in
**Impostazioni** aggiungi i nomi delle parrucchiere.

---

## Uso di tutti i giorni

- **Clienti**: in ordine alfabetico, con le lettere A, B, C… a dividere l'elenco. Scegli tu se ordinare per
  **cognome** o per **nome**: l'app se lo ricorda. Puoi cercare per nome, cognome o telefono, oppure filtrare per parrucchiera.
- **+ Nuova cliente**: nome, cognome, telefono, parrucchiera che la segue, note fisse (allergie, cute sensibile…).
- Nella scheda della cliente:
  - **+ Nuova scheda** registra data, parrucchiera, servizio, formula, ossigeno, posa e risultato;
  - **Riusa questa formula** apre una nuova scheda già compilata con la formula di quella volta.
- **Schede di carta**: nella pagina della cliente premi **📷 Carica foto**. Dal telefono puoi scattare la foto
  o sceglierla dalla galleria, anche più foto insieme (fronte e retro).
  - Le foto compaiono come miniature: toccale per vederle a schermo intero, ingrandirle e aggiungere data e nota.
  - **Trascrivi in una scheda** apre la scheda da compilare con la foto accanto, così puoi copiarla con calma.
    Si possono tenere solo le foto, solo le schede scritte, o entrambe.
  - L'app riduce le foto (lato lungo massimo 2000 pixel, sotto 1 MB) prima di salvarle: la scrittura resta
    leggibile e con il piano gratuito ci stanno alcune migliaia di foto.
  - Su iPhone, se una foto non viene accettata: Impostazioni → Fotocamera → Formati → **Più compatibile**.
- Si può lavorare in più persone insieme: le modifiche compaiono subito su tutti i dispositivi.

### Password dimenticata
Firebase → **Authentication → Utenti** → sulla riga di `futuresun@staff.schede-colore.app` → **⋮ → Elimina account**.
Poi ricrealo come al passo 5.1 con una password nuova. Clienti e schede **non** vengono toccate.

### Cambiare il nickname
Va cambiato in tre posti: l'utente in Authentication, l'email in `firestore.rules` (poi ripubblica le regole) e
questa guida. Chiedi pure aiuto.

---

## Backup dei dati

Ci sono due livelli di backup. Ti consiglio di usarli **tutti e due**.

### 1. Backup su file, dall'app (gratis)

*Impostazioni → Backup dei dati → **Scarica backup adesso*** scarica un file
`schede-colore-backup-AAAA-MM-GG.json` con tutte le clienti, le schede, le foto e le parrucchiere.
Con tante foto il file può pesare qualche centinaio di MB: è normale.

- Fallo **almeno una volta a settimana**. Se passano più di 7 giorni, l'app lo ricorda
  in cima all'elenco clienti.
- Conserva il file in un posto sicuro: una chiavetta USB tenuta in salone, oppure una cartella protetta da
  password. **Non mandarlo via WhatsApp o email**: contiene dati personali delle clienti.
- **Ripristina da un file…** rimette clienti e schede com'erano nel backup. Quelle aggiunte dopo non vengono toccate.

### 2. Backup automatici di Firebase (consigliato, costa pochi centesimi al mese)

Firebase può fare da solo una copia ogni giorno, senza che nessuno se ne debba ricordare.
Serve il piano **Blaze** (a consumo). Per un salone il costo è praticamente zero, di solito meno di 1 € al mese.

1. Console Firebase → in basso a sinistra **Upgrade** → piano **Blaze** → collega una carta.
2. Imposta subito un **avviso di budget**, per esempio 5 €: così ricevi un'email se la spesa supera la cifra
   (Google Cloud → Fatturazione → Budget e avvisi).
3. Apri <https://console.cloud.google.com>, scegli il tuo progetto in alto e clicca l'icona **Cloud Shell** `>_`
   in alto a destra. Si apre un terminale nel browser, senza installare niente.
4. Incolla questi comandi, mettendo il tuo ID progetto al posto di `ID-PROGETTO`:

   ```
   gcloud config set project ID-PROGETTO

   # una copia ogni giorno, tenuta 7 giorni
   gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d

   # una copia ogni domenica, tenuta 14 settimane
   gcloud firestore backups schedules create --database='(default)' --recurrence=weekly --day-of-week=SUN --retention=14w
   ```

5. Per controllare che siano attivi:

   ```
   gcloud firestore backups schedules list --database='(default)'
   ```

In più puoi attivare il **ripristino a un momento preciso** (ultimi 7 giorni, utile se qualcuno cancella per errore):

```
gcloud firestore databases update --database='(default)' --enable-pitr
```

E una **protezione contro la cancellazione dell'intero database** (per esempio per un clic sbagliato nella console):

```
gcloud firestore databases update --database='(default)' --delete-protection
```

**Per ripristinare un backup automatico** servono alcuni comandi tecnici (il backup viene ripristinato in un
database nuovo e poi va ricollegato all'app). Se ti capita, chiedi aiuto: i dati sono al sicuro nel backup
finché non scade.

---

---

## Privacy e dati sensibili (GDPR)

- Le schede contengono dati personali e a volte sanitari (allergie, reazioni della cute): raccogli il
  **consenso** della cliente e dalle l'**informativa privacy**. Il tuo consulente privacy può fornirti un modello.
- In Firebase → Impostazioni progetto → **Privacy** puoi accettare l'«Emendamento sul trattamento dei dati» (DPA) di Google.
- Dai la password solo a chi lavora in salone e **cambiala** quando qualcuno se ne va.
- Non lasciare l'app aperta su dispositivi condivisi: c'è l'uscita automatica, ma premere «Esci» è meglio.

---

## Per lo sviluppatore

```
npm install
npm test          # prova le regole di sicurezza sull'emulatore (serve Java)
npm run locale    # emulatori: apri http://127.0.0.1:5050/?emulatori=1
```

Con `?emulatori=1` su localhost l'app usa gli emulatori locali invece del progetto vero.
Ogni modifica al ramo `main` viene pubblicata da sola su GitHub Pages (`.github/workflows/pages.yml`).
Le regole di Firestore invece vanno ripubblicate a mano (passo 6) o con `firebase deploy --only firestore:rules`.
