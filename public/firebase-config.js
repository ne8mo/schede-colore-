// Configurazione del progetto Firebase «gestionale-schede-tecniche»
// (Console Firebase → Impostazioni progetto → Le tue app → Configurazione SDK).
// Questi valori NON sono segreti: la protezione dei dati la fanno le regole di Firestore.
export const firebaseConfig = {
  apiKey: "AIzaSyBQqDI5t5i1jGyYsukHttpwNpztvpbvdhc",
  authDomain: "gestionale-schede-tecniche.firebaseapp.com",
  projectId: "gestionale-schede-tecniche",
  storageBucket: "gestionale-schede-tecniche.firebasestorage.app",
  messagingSenderId: "198531996172",
  appId: "1:198531996172:web:d43e6050b5e4bce9c72c29",
};

// Nome del salone mostrato nell'app
export const nomeSalone = "Future'Sun";

// Dopo quanti minuti senza usare l'app si viene disconnessi (dati sensibili)
export const minutiInattivita = 20;
