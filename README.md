# Schede colore – Future'Sun

Gestionale delle schede colore del salone: clienti, formule, ossigeno, posa, note e parrucchiera che segue la cliente.
Si entra solo con **nickname e password**, gli accessi li crea l'amministratore.

Funziona da computer, tablet e telefono. I dati stanno su **Firebase** (Google), protetti da regole di sicurezza
che permettono di leggere e scrivere **solo** alle persone abilitate nell'elenco «Accessi».

---

## Come funziona la sicurezza

- **Login con nickname e password.** Firebase usa internamente un indirizzo email finto
  (`nickname@staff.schede-colore.app`). Nessuna email viene mai inviata.
- **Chi non è nell'elenco «Accessi» non vede niente.** Anche se qualcuno riuscisse a creare un account da solo,
  le regole del database ([`firestore.rules`](firestore.rules)) gli negano ogni lettura e scrittura.
- **Bloccare una persona è immediato.** Se una dipendente se ne va, in *Impostazioni → Accessi* premi
  «Blocca accesso» e non vede più nulla, anche se ricorda la password.
- **Due ruoli.**
  - *Personale*: vede e modifica clienti e schede.
  - *Amministratore*: in più crea e blocca gli accessi ed elimina le clienti.
- **Uscita automatica.** Dopo 20 minuti senza usare l'app, o chiudendo il browser, bisogna rientrare.
  I minuti si cambiano in `public/firebase-config.js`.
- **Il sito non compare su Google** (`noindex` e `robots.txt`).

Le regole sono verificate da prove automatiche (`npm test`). Le prove controllano che visitatori, account
non abilitati e account bloccati non possano leggere nulla.

---

## Metodo senza computer: GitHub Pages + regole incollate nella console

È il modo più semplice: niente installazioni sul PC.

1. Fai i passi **1, 2, 3 e 4** qui sotto (progetto, login, database, configurazione).
2. **Regole di sicurezza:** apri il file [`firestore.rules`](firestore.rules) su GitHub, copia tutto il testo, poi
   in Firebase vai su **Firestore Database → Regole**, cancella quello che c'è, incolla e premi **Pubblica**.
3. **Pubblica l'app:** su GitHub, nel repository, **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Poi nella scheda **Actions** apri «Pubblica su GitHub Pages» e premi **Run workflow** (solo la prima volta:
   dopo si aggiorna da sola a ogni modifica).
4. L'app è su **`https://<utente>.github.io/<repository>/`**, per esempio `https://ne8mo.github.io/schede-colore-/`.
5. In Firebase, **Authentication → Impostazioni → Domini autorizzati → Aggiungi dominio**: `<utente>.github.io`.
6. Apri l'app e fai il **Primo avvio** (passo 7 qui sotto).

Se in futuro cambiano le regole di sicurezza, vanno incollate di nuovo come al punto 2.

## Mettere online l'app su Firebase (una volta sola)

Ti servono circa 20 minuti e un account Google. Firebase con il piano gratuito **Spark** basta e avanza per un salone.

### 1. Crea il progetto

1. Vai su <https://console.firebase.google.com> ed entra con il tuo account Google.
2. **Crea un progetto**, per esempio `schede-colore-futuresun`.
3. Google Analytics: **disattivalo**, non serve.

### 2. Attiva il login

1. Nel menu a sinistra: **Build → Authentication → Inizia**.
2. Scheda **Metodo di accesso** → **Email/password** → attiva **solo la prima voce** (non "link email") → **Salva**.

### 3. Crea il database (in Europa)

1. Menu: **Build → Firestore Database → Crea database**.
2. **Edizione Standard**.
3. **Località**: scegli **`europe-west8 (Milano)`** oppure `eur3 (Europa)`. I dati delle clienti restano così
   in Europa, come chiede il GDPR. **Non si può cambiare dopo.**
4. Avvia in **modalità di produzione** (tutto chiuso). Le regole giuste le carichi al punto 6.

### 4. Collega l'app al progetto

1. Clicca l'**ingranaggio ⚙ → Impostazioni progetto**.
2. In basso, «Le tue app»: clicca l'icona **`</>` (Web)**, dai un nome (es. `schede`), **non** spuntare Hosting qui → **Registra app**.
3. Ti mostra un blocco `const firebaseConfig = { apiKey: ..., ... }`.
   Copia i valori dentro **`public/firebase-config.js`** al posto di `INCOLLA-QUI`.

> Questi valori non sono password: servono solo a dire all'app quale progetto usare.
> La protezione vera la fanno le regole del database.

### 5. Installa lo strumento di Firebase sul computer

Serve [Node.js](https://nodejs.org) (versione "LTS"). Dopo averlo installato apri il **Prompt dei comandi**
nella cartella del progetto e scrivi:

```
npm install -g firebase-tools
firebase login
```

Si apre il browser: entra con lo stesso account Google del progetto.

Poi collega la cartella al tuo progetto:

```
firebase use --add
```

Scegli il progetto creato al punto 1 e come nome scrivi `default`.

### 6. Pubblica regole di sicurezza e app

```
firebase deploy --only firestore:rules,hosting
```

Alla fine compare un indirizzo tipo **`https://schede-colore-futuresun.web.app`**: è la tua app.

### 7. Primo avvio

1. Apri l'indirizzo. La prima volta compare **«Primo avvio»**: crea il tuo account amministratore
   (nome, nickname, password di almeno 8 caratteri).
   **Fallo subito dopo aver pubblicato**: il primo account creato diventa amministratore, e dopo questa
   schermata non compare più.
2. Vai in **Impostazioni**:
   - aggiungi i nomi delle **parrucchiere**;
   - in **Accessi** crea nickname e password per chi deve usare l'app. Comunica la password di persona,
     mai per messaggio.
3. Ognuna può cambiare la propria password in *Impostazioni → La mia password*.

---

## Uso di tutti i giorni

- **Clienti**: in ordine alfabetico, con le lettere A, B, C… a dividere l'elenco. Scegli tu se ordinare per
  **cognome** o per **nome**: l'app se lo ricorda. Puoi cercare per nome, cognome o telefono, oppure filtrare per parrucchiera.
- **+ Nuova cliente**: nome, cognome, telefono, parrucchiera che la segue, note fisse (allergie, cute sensibile…).
- Nella scheda della cliente:
  - **+ Nuova scheda** registra data, parrucchiera, servizio, formula, ossigeno, posa e risultato;
  - **Riusa questa formula** apre una nuova scheda già compilata con la formula di quella volta,
    così cambi solo quello che serve.
- Si può lavorare in più persone insieme: le modifiche compaiono subito su tutti i dispositivi.

### Se una dipendente dimentica la password

Per sicurezza l'app non permette di vedere o reimpostare le password altrui. L'amministratore blocca il vecchio
accesso e ne crea uno nuovo con un nickname diverso (es. `sara2`).

### Se l'amministratrice dimentica la password

Se c'è un'altra amministratrice, basta che crei un nuovo accesso. Altrimenti, dalla console Firebase:

1. **Authentication → Utenti → Aggiungi utente**:
   - email: `nuovonick@staff.schede-colore.app`;
   - password nuova.

   Copia l'**UID utente** che compare nell'elenco.
2. **Firestore Database → collezione `staff` → Aggiungi documento**:
   - come ID documento incolla l'UID;
   - aggiungi i campi `nome` (stringa), `nickname` (stringa, `nuovonick`), `ruolo` (stringa, `admin`), `attivo` (booleano, `true`).
3. Entra nell'app con `nuovonick` e la nuova password, poi blocca il vecchio accesso.

Conviene avere **sempre almeno due amministratori**.

---

## Backup dei dati

Ci sono due livelli di backup. Ti consiglio di usarli **tutti e due**.

### 1. Backup su file, dall'app (gratis)

*Impostazioni → Backup dei dati → **Scarica backup adesso*** scarica un file
`schede-colore-backup-AAAA-MM-GG.json` con tutte le clienti, le schede e le parrucchiere.

- Fallo **almeno una volta a settimana**. Se passano più di 7 giorni, l'app lo ricorda all'amministratore
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

## Privacy e dati sensibili (GDPR)

- Le schede contengono dati personali e a volte sanitari (allergie, reazioni della cute): raccogli il
  **consenso** della cliente e dalle l'**informativa privacy**. Il tuo commercialista o consulente privacy
  può fornirti un modello.
- In Firebase → Impostazioni progetto → **Privacy** puoi accettare l'«Emendamento sul trattamento dei dati» (DPA) di Google.
- Crea accessi solo per chi ne ha bisogno e **blocca subito** chi non lavora più in salone.
- Non lasciare l'app aperta su dispositivi condivisi: c'è l'uscita automatica, ma premere «Esci» è meglio.

---

## Per lo sviluppatore

```
npm install
npm test          # prova le regole di sicurezza sull'emulatore (serve Java)
npm run locale    # emulatori: apri http://127.0.0.1:5050/?emulatori=1
npm run pubblica  # pubblica regole e app
```

Con `?emulatori=1` su localhost l'app usa gli emulatori locali invece del progetto vero.
