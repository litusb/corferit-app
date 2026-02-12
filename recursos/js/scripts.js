// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    onSnapshot,
    query,
    orderBy,
    limit,
    doc,
    getDoc,
    getDocs,
    deleteDoc,
    setDoc,
    serverTimestamp,
    writeBatch,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

// Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyCLRBsJDKcv9I0hf3uosB0F3w7rXWU-40A",
    authDomain: "corferit-daus.firebaseapp.com",
    projectId: "corferit-daus",
    storageBucket: "corferit-daus.firebasestorage.app",
    messagingSenderId: "756634249064",
    appId: "1:756634249064:web:8e09d8bf75aebcb1b118dd",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Variables Globals.
let currentRoomName = null;
let currentRollsRef = null;

async function cleanOldRooms(currentRoomName) {
    const roomsSnapshot = await getDocs(collection(db, "rooms"));
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    let batch = writeBatch(db);
    let operationsCount = 0;

    async function commitBatchIfFull() {
        if (operationsCount >= 450) { // 450 para estar seguros
            await batch.commit();
            console.log("Batch intermedio ejecutado");
            batch = writeBatch(db);
            operationsCount = 0;
        }
    }

    // ----------------------------
    // Limpiar rooms viejas
    // ----------------------------
    for (const roomDoc of roomsSnapshot.docs) {
        const roomId = roomDoc.id;
        const data = roomDoc.data();

        if (roomId === "sala-principal") continue;

        if (data.createdAt && data.createdAt.toMillis) {
            const roomAge = now - data.createdAt.toMillis();

            if (roomAge > DAY) {
                // Borrar rolls
                const rollsSnapshot = await getDocs(collection(db, "rooms", roomId, "rolls"));
                for (const rollDoc of rollsSnapshot.docs) {
                    batch.delete(rollDoc.ref);
                    operationsCount++;
                    await commitBatchIfFull();
                }

                // Borrar room
                batch.delete(roomDoc.ref);
                operationsCount++;
                await commitBatchIfFull();
            }
        }
    }

    // ----------------------------
    // Limpiar rolls antiguos de la sala actual
    // ----------------------------
    if (currentRoomName) {
        const rollsSnapshot = await getDocs(collection(db, "rooms", currentRoomName, "rolls"));
        for (const rollDoc of rollsSnapshot.docs) {
            const rollData = rollDoc.data();
            if (rollData.time && rollData.time.toMillis) {
                const rollAge = now - rollData.time.toMillis();
                if (rollAge > DAY) {
                    batch.delete(rollDoc.ref);
                    operationsCount++;
                    await commitBatchIfFull();
                }
            }
        }
    }

    // ----------------------------
    // Ejecutar batch final
    // ----------------------------
    if (operationsCount > 0) {
        try {
            await batch.commit();
            console.log("Batch final ejecutado, limpieza completada");
        } catch (e) {
            console.error("Error al ejecutar el batch final:", e);
        }
    }
}

// Sala desde URL amb el paràmetre *room* o *sala*.
function getRoomFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("room") || params.get("sala") || "sala-general";
}

// LOGIN
window.login = async function () {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        alert("Error de login: " + error.message);
    }
};

// LOGOUT
window.logout = async function () {
    await signOut(auth);
};

// Comprovar si l'usuari és màster.
async function checkMaster(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        const data = userSnap.data();
        return data.isMaster === true;
    }
    return false;
}

// Ens autentifiquem i pasen coses.
onAuthStateChanged(auth, async (user) => {
    // Si no estàs autentificat mostra el login i surt del bucle.
    if (!user) {
        document.getElementById("loginBox").style.display = "block";
        document.getElementById("app").style.display = "none";
        return;
    }

    if ((new URLSearchParams(window.location.search)).get("eines")) {
        document.getElementById("eines").style.display = "block";
    }

    // Per defecte (si estàs autentificat) amaga la caixa de login i ensenya la app.
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("app").style.display = "block";

    const roomName = getRoomFromURL();
    if (roomName != "sala-general") {
        document.getElementById("roomLabel").innerText = "Sala » " + roomName;
    }

    // Intenta crear la sala a Firebase.
    const roomRef = doc(db, "rooms", roomName);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
        try {
            await setDoc(roomRef, {
                name: roomName,
                createdAt: serverTimestamp(),
            });
        } catch (e) {
            console.warn("No tens permisos per crear aquesta sala.");
            return;
        }
    }

    // Creem l'historial de tirades.
    const rollsRef = collection(db, "rooms", roomName, "rolls");
    const q = query(rollsRef, orderBy("time", "desc"), limit(50));

    // Ara sí, inicialitzem les variables globals dins el bucle d'autentificació.
    currentRoomName = roomName;
    currentRollsRef = collection(db, "rooms", roomName, "rolls");

    cleanOldRooms(currentRoomName);

    const isMaster = await checkMaster(user);

    startApp({
        isMaster,
        roomName,
        rollsRef,
        q,
    });
});

// Firestore a temps real.
function startApp({ isMaster, roomName, rollsRef, q }) {
    onSnapshot(q, (snapshot) => {
        const historyDiv = document.getElementById("history");
        historyDiv.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            let formattedTime = "";

            if (data.time && typeof data.time.toDate === "function") {
                formattedTime = data.time.toDate().toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
            }
            historyDiv.innerHTML += `<div>[${formattedTime}] ${data.text}</div><hr>`;
        });
    });

    // ==== CONTADOR DE POR ====
    let currentFear = 0;
    let maxFear = 12;

    const fearContainer = document.getElementById("fearContainer");
    const fearControls = document.getElementById("fearControls");
    const fearPlus = document.getElementById("fearPlus");
    const fearMinus = document.getElementById("fearMinus");

    // Renderiza los dots según currentFear y maxFear
    function renderFearDots() {
        fearContainer.innerHTML = "";
        for (let i = 0; i < maxFear; i++) {
            const dot = document.createElement("div");
            dot.className = "fear-dot";
            if (i < currentFear) dot.classList.add("filled");

            if (isMaster) {
                // clic izquierdo = aumentar hasta ese punto
                dot.addEventListener("click", () => {
                    currentFear = i + 1;
                    updateFearDisplay();
                    saveFear();
                });
                // clic derecho = disminuir hasta ese punto
                dot.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    currentFear = i;
                    updateFearDisplay();
                    saveFear();
                });
            }

            fearContainer.appendChild(dot);
        }
    }

    // Actualiza el display sin tocar Firestore
    function updateFearDisplay() {
        const dots = document.querySelectorAll(".fear-dot");
        dots.forEach((dot, index) => {
            dot.classList.toggle("filled", index < currentFear);
        });
    }

    // Guardar en Firestore
    async function saveFear() {
        try {
            const fearRef = doc(db, "rooms", roomName, "fear", "counter");

            await setDoc(fearRef, { value: currentFear, max: maxFear });
        } catch (err) {
            console.error("Error guardando Fear en Firestore:", err);
        }
    }

    // Sincronización en tiempo real con Firestore
    const fearRef = doc(db, "rooms", roomName, "fear", "counter");

    onSnapshot(fearRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentFear = data.value ?? 0;
            maxFear = data.max ?? 12;
        }
        renderFearDots();
    });

    // Botones de añadir/quitar casillas
    fearPlus.addEventListener("click", () => {
        maxFear++;
        renderFearDots();
        saveFear();
    });
    fearMinus.addEventListener("click", () => {
        if (maxFear > 12) maxFear--;
        if (currentFear > maxFear) currentFear = maxFear;
        renderFearDots();
        saveFear();
    });

    // Mostrar controles solo si es master
    fearControls.style.display = isMaster ? "flex" : "none";

    // Render inicial para que se vean los dots aunque Firestore esté vacío
    renderFearDots();
}
//acaba startApp()

// 🎲 Dados
window.rollD12 = function () {
    return Math.floor(Math.random() * 12) + 1;
};
window.rollD6 = function () {
    return Math.floor(Math.random() * 6) + 1;
};

let fixedModifier = 0;

window.changeFixedModifier = function (amount) {
    fixedModifier += amount;
    document.getElementById("modifierInput").value = fixedModifier;
};
document
.getElementById("modifierInput")
.addEventListener("input", (e) => {
    fixedModifier = parseInt(e.target.value) || 0;
});
let fixedModifierHTML = "";

window.rollDuality = async function (v) {
    const esperança = rollD12();
    const por = rollD12();
    const d6 = rollD6();

    let winner = "";
    let final = esperança + por;
    let colorClass = "";
    let isCritical = false;

    if (esperança === por) {
        isCritical = true;
    }

    if (esperança >= por) {
        winner = "Esperança";
        colorClass = "esperança";
    } else {
        winner = "Por";
        colorClass = "por";
    }

    // Av/Des diferenciat
    let modifierHTML = "";

    if (v === 1) {
        final += d6;
        modifierHTML = `<span class="dice-icon adv-die roll-animate">${d6}</span>`;
    } else if (v === 0) {
        final -= d6;
        modifierHTML = `<span class="dice-icon dis-die roll-animate">${d6}</span>`;
    }

    const player =
    document.getElementById("playerName").value || auth.currentUser.email;

    let criticalHTML = "";
    if (isCritical) {
        criticalHTML = `<span class="critical">🎯 ÈXIT CRÍTIC! 🎯</span>`;
    }

    let finalWithModifier = final + fixedModifier;

    if (fixedModifier != 0) {
        fixedModifierHTML = `<span class="dice-icon modificador-fixe roll-animate">${fixedModifier >= 0 ? "+" : ""}${fixedModifier}</span>`;
    }
    // Versió animada amb Av/Des diferenciat
    const text = `
    <strong>${player}</strong><br><br>

    <span class="dice-icon esperanca-die roll-animate">${esperança}</span>
    <span class="dice-icon por-die roll-animate">${por}</span>
    ${modifierHTML}
    ${fixedModifierHTML}

    <br><br>
    <strong>${finalWithModifier}</strong> amb
    <span class="${colorClass}">${winner}</span>
    ${criticalHTML}
    `;

    document.getElementById("result").innerHTML = text;

    if (!currentRollsRef) {
        console.warn("La sala no está inicializada aún");
        return;
    }

    await addDoc(currentRollsRef, {
        text: text,
        time: serverTimestamp(),
    });
};
const diceTypes = [3, 4, 6, 8, 10, 12, 20, 100];

function createDiceMenu() {
    const container = document.getElementById("diceMenu");
    container.innerHTML = "";

    diceTypes.forEach((sides) => {
        const row = document.createElement("div");
        row.className = "dice-row";

        // Modo iconos pulsables
        row.innerHTML = `
        <div class="dice-icon d${sides}" onclick="rollSingleDie(${sides})">
        d${sides}
        </div>
        <div class="counter">
        <button onclick="changeDice(${sides}, -1)">-</button>
        <input type="number" id="dice-${sides}" value="0" min="0">
        <button onclick="changeDice(${sides}, 1)">+</button>
        </div>
        `;

        container.appendChild(row);
    });
}

// Creem el menu de daus.
createDiceMenu();

window.clearDice = async function () {
    // Resetear selección de dados
    diceTypes.forEach((sides) => {
        document.getElementById(`dice-${sides}`).value = 0;
    });

    // Resetear modificador fijo
    fixedModifier = 0;
    const modifierInput = document.getElementById("modifierInput");
    if (modifierInput) modifierInput.value = 0;
    fixedModifierHTML = "";
};

window.changeDice = function (sides, delta) {
    const input = document.getElementById(`dice-${sides}`);
    let value = parseInt(input.value) || 0;
    value += delta;
    if (value < 0) value = 0;
    input.value = value;
};

// Daus clàssics
window.rollCustomDice = async function () {
    let resultsHTML = "";
    let total = 0;
    let rolledSomething = false;

    diceTypes.forEach((sides) => {
        const qty =
        parseInt(document.getElementById(`dice-${sides}`).value) || 0;

        for (let i = 0; i < qty; i++) {
            const roll = Math.floor(Math.random() * sides) + 1;
            total += roll;
            rolledSomething = true;

            resultsHTML += `<span class="dice-icon d${sides} roll-animate">${roll}</span>`;
        }
    });

    if (!rolledSomething) {
        alert("No has seleccionado ningún dado.");
        return;
    }

    let totalWithModifier = total + fixedModifier;

    const player =
    document.getElementById("playerName").value || auth.currentUser.email;

    if (fixedModifier != 0) {
        fixedModifierHTML = `<span class="dice-icon modificador-fixe roll-animate">${fixedModifier >= 0 ? "+" : ""}${fixedModifier}</span>`;
    }
    const text = `
    <strong>${player}</strong><br>
    ${resultsHTML}
    ${fixedModifierHTML}

    <br><br>
    <strong>Total: ${totalWithModifier}</strong>
    `;

    document.getElementById("result").innerHTML = text;
    if (!currentRollsRef) {
        console.warn("La sala no está inicializada aún");
        return;
    }
    await addDoc(currentRollsRef, {
        text: text,
        time: serverTimestamp(),
    });
};
window.rollSingleDie = async function (sides) {
    const roll = Math.floor(Math.random() * sides) + 1;
    const player =
    document.getElementById("playerName").value || auth.currentUser.email;

    const resultHTML = `
    <strong>${player}</strong><br><br>
    <span class="dice-icon d${sides} roll-animate">${roll}</span>
    <br><br>
    <strong>Total: ${roll}</strong>
    `;

    document.getElementById("result").innerHTML = resultHTML;
    if (!currentRollsRef) {
        console.warn("La sala no está inicializada aún");
        return;
    }
    await addDoc(currentRollsRef, {
        text: resultHTML,
        time: serverTimestamp(),
    });
};
const toggleDice = document.getElementById("toggleDice");
toggleDice.addEventListener("click", () => {
    const container = document.getElementById("diceContainer");
    const modifierDiv = document.getElementById("fixedModifier");

    if (container.style.display === "none") {
        container.style.display = "block";
        modifierDiv.style.display = "block";
        toggleDice.innerText = "▼ Daus clàssics";
    } else {
        container.style.display = "none";
        modifierDiv.style.display = "none";
        toggleDice.innerText = "► Daus clàssics";
    }
});
