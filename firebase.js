/* firebase.js — este arquivo não é mais usado.
   A integração com Firestore está em script.js. */
// import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

/* ── CREDENCIAIS ─────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "AIzaSyDYwBUEWhQNCRB5wZUCP1PrkgK_Q57QIZo",
  authDomain:        "artistas-na-rua.firebaseapp.com",
  projectId:         "artistas-na-rua",
  storageBucket:     "artistas-na-rua.firebasestorage.app",
  messagingSenderId: "998571196526",
  appId:             "1:998571196526:web:b3f4e7d65bba6bdf32e67f",
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const COLL = "artistas"; // nome da coleção no Firestore

/* ── API PÚBLICA ─────────────────────────────────────────── */

/**
 * Carrega todos os artistas do Firestore.
 * Retorna array ordenado por score decrescente.
 */
export async function dbLoad() {
  try {
    const snap = await getDocs(collection(db, COLL));
    return snap.docs.map(d => ({ ...d.data(), id: parseInt(d.id) }));
  } catch (e) {
    console.error("Erro ao carregar Firestore:", e);
    return null; // null = fallback para localStorage
  }
}

/**
 * Salva ou atualiza um artista no Firestore.
 * @param {object} artist — objeto completo do artista (com id)
 */
export async function dbSave(artist) {
  try {
    await setDoc(doc(db, COLL, String(artist.id)), artist);
  } catch (e) {
    console.error("Erro ao salvar no Firestore:", e);
  }
}

/**
 * Remove um artista do Firestore pelo id.
 * @param {number} id
 */
export async function dbDelete(id) {
  try {
    await deleteDoc(doc(db, COLL, String(id)));
  } catch (e) {
    console.error("Erro ao deletar do Firestore:", e);
  }
}

/**
 * Salva a lista inteira de artistas (usado em importação).
 * Apaga todos e reescreve.
 */
export async function dbSaveAll(artists) {
  try {
    // Deleta todos existentes
    const snap = await getDocs(collection(db, COLL));
    const dels = snap.docs.map(d => deleteDoc(doc(db, COLL, d.id)));
    await Promise.all(dels);
    // Salva os novos
    const saves = artists.map(a => setDoc(doc(db, COLL, String(a.id)), a));
    await Promise.all(saves);
  } catch (e) {
    console.error("Erro ao salvar tudo no Firestore:", e);
  }
}
