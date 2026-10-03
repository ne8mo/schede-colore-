// Riduce le foto delle schede cartacee prima di salvarle.
// Le foto vengono salvate nel database (piano gratuito di Firebase): ogni documento può pesare al massimo 1 MB,
// quindi la foto viene ridimensionata e compressa in JPEG finché non sta sotto quel limite.

const LATO_MASSIMO = 2000;        // pixel sul lato lungo: la scrittura resta ben leggibile
const CARATTERI_MASSIMI = 900000; // margine sotto il limite di 1 MB di Firestore

async function apriImmagine(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function comprimiFoto(file) {
  let sorgente;
  try {
    sorgente = await apriImmagine(file);
  } catch {
    throw new Error(`«${file.name}» non è un'immagine leggibile. Usa foto JPG o PNG `
      + "(su iPhone: Impostazioni → Fotocamera → Formati → «Più compatibile»).");
  }
  const larghezzaOrig = sorgente.width;
  const altezzaOrig = sorgente.height;
  let scala = Math.min(1, LATO_MASSIMO / Math.max(larghezzaOrig, altezzaOrig));
  let qualita = 0.82;
  const tela = document.createElement("canvas");
  const ctx = tela.getContext("2d");
  for (let tentativo = 0; tentativo < 10; tentativo++) {
    tela.width = Math.max(1, Math.round(larghezzaOrig * scala));
    tela.height = Math.max(1, Math.round(altezzaOrig * scala));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, tela.width, tela.height);
    ctx.drawImage(sorgente, 0, 0, tela.width, tela.height);
    const immagine = tela.toDataURL("image/jpeg", qualita);
    if (immagine.length <= CARATTERI_MASSIMI) {
      sorgente.close?.();
      return { immagine, larghezza: tela.width, altezza: tela.height };
    }
    if (qualita > 0.6) qualita -= 0.1;
    else scala *= 0.8;
  }
  sorgente.close?.();
  throw new Error(`Non riesco a ridurre abbastanza «${file.name}».`);
}

export function immagineSicura(url) {
  return typeof url === "string" && url.startsWith("data:image/") ? url : "";
}
