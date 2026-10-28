/**
 * js/app.js
 * Control de cámara, inferencia con TensorFlow.js y gestión de inventario en tiempo real.
 */

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const panelInventario = document.getElementById("panel-inventario");

let currentStream = null;
let facingMode = "environment"; // En celulares inicia con la cámara trasera
let modelo = null;
let clases = ["Botella de Agua", "Sin Producto"]; // Clases por defecto
let escanearActivo = true;
let ultimaCaptura = null;
let mensajeOperacion = "";
let tipoMensajeOperacion = "success";

// 1. Cargar el modelo de IA desde la carpeta /modelo
async function cargarModelo() {
  const mensaje = document.getElementById("mensaje-estado");
  try {
    mensaje.innerText = "Cargando modelo de IA...";

    // Cargar la arquitectura y los pesos
    modelo = await tf.loadLayersModel("modelo/model.json");

    // Intentar leer las etiquetas desde metadata.json
    try {
      const resp = await fetch("modelo/metadata.json");
      if (resp.ok) {
        const metadata = await resp.json();
        if (metadata.labels && metadata.labels.length > 0) {
          clases = metadata.labels;
        }
      }
    } catch (e) {
      console.log("Usando etiquetas por defecto.");
    }

    document.getElementById("spinner-carga").style.display = "none";
    mensaje.innerText = "Listo: Apunte la cámara a la botella";
    console.log("✅ Modelo cargado con éxito.");
  } catch (error) {
    console.error("Error al cargar el modelo:", error);
    const spinner = document.getElementById("spinner-carga");
    if (spinner) {
      spinner.className = "bi bi-exclamation-triangle text-danger fs-2 mb-2";
    }
    mensaje.innerHTML = `
      <span class="text-danger fw-bold">Error al cargar el modelo:</span><br>
      <small class="text-danger text-break">${error.message || error}</small>
    `;
  }
}

// 2. Iniciar y configurar la cámara
async function iniciarCamara() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: facingMode,
      width: { ideal: 400 },
      height: { ideal: 400 }
    }
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    video.onloadedmetadata = () => {
      video.play();
      dibujarEnCanvas();
      iniciarBuclePrediccion();
    };
  } catch (err) {
    console.error("Error de cámara:", err);
    panelInventario.innerHTML = `
      <div class="text-center text-danger py-3">
        <i class="bi bi-camera-video-off fs-1 d-block mb-2"></i>
        <p class="mb-0 fw-semibold">No se pudo acceder a la cámara</p>
        <small class="text-muted">Por favor concede permiso de cámara en tu navegador.</small>
      </div>`;
  }
}

// 3. Alternar entre cámara trasera y delantera (en celular)
function cambiarCamara() {
  facingMode = facingMode === "user" ? "environment" : "user";
  iniciarCamara();
}

// 4. Dibujar continuamente los fotogramas en el canvas
function dibujarEnCanvas() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(dibujarEnCanvas);
}

// 5. Bucle de predicción continua
async function iniciarBuclePrediccion() {
  if (modelo && escanearActivo && video.readyState === video.HAVE_ENOUGH_DATA) {
    await predecirFrame();
  }
  // Ejecuta la clasificación cada 250 ms (4 veces por segundo)
  setTimeout(iniciarBuclePrediccion, 250);
}

// 6. Preprocesar recortando el centro del visor (donde está el recuadro)
async function predecirFrame() {
  tf.tidy(() => {
    const inputShape = modelo.inputs[0].shape;
    const reqH = inputShape[1] || 150;
    const reqW = inputShape[2] || 150;
    // Tomar el fotograma
    let tensor = tf.browser.fromPixels(canvas);
    // Recortar el 50% central (el área del recuadro guía donde pones la botella)
    // [y1, x1, y2, x2] normalizado de 0 a 1
    const cajas = [[0.2, 0.2, 0.8, 0.8]];
    const indices = [0];
    tensor = tf.image.cropAndResize(tensor.expandDims(0), cajas, indices, [reqH, reqW]);
    // Normalizar de [0, 255] a [0.0, 1.0]
    tensor = tensor.div(tf.scalar(255.0));
    // Ejecutar predicción
    const prediccion = modelo.predict(tensor);
    const valores = prediccion.dataSync();
    procesarResultado(valores);
  });
}

// 7. Interpretar la predicción y actualizar la interfaz
function procesarResultado(valores) {
  let claseDetectada = "";
  let certeza = 0;

  if (valores.length === 1) {
    // Modelo binario
    if (valores[0] < 0.5) {
      claseDetectada = clases[0];
      certeza = Math.round((1 - valores[0]) * 100);
    } else {
      claseDetectada = clases[1] || "Sin Producto";
      certeza = Math.round(valores[0] * 100);
    }
  } else {
    // Modelo multiclase (Softmax)
    let maxIdx = 0;
    for (let i = 1; i < valores.length; i++) {
      if (valores[i] > valores[maxIdx]) maxIdx = i;
    }
    claseDetectada = clases[maxIdx];
    certeza = Math.round(valores[maxIdx] * 100);
  }

  // Si detecta la botella con al menos 65% de certeza, muestra el inventario
  if (claseDetectada.toLowerCase().includes("botella") && certeza >= 65) {
    renderizarInventario(claseDetectada, certeza);
  } else {
    renderizarBuscando();
  }
}

// 8. Mostrar la ficha del producto con stock interactivo
function renderizarInventario(nombreClase, certeza = 95) {
  const p = obtenerDatosBotella();

  // Estados visuales del stock
  let estadoBadge = `<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>En Stock</span>`;
  let colorStock = "text-dark";

  if (p.stock === 0) {
    estadoBadge = `<span class="badge bg-danger"><i class="bi bi-x-circle me-1"></i>Agotado</span>`;
    colorStock = "text-danger";
  } else if (p.stock <= p.stockMinimo) {
    estadoBadge = `<span class="badge bg-warning text-dark"><i class="bi bi-exclamation-triangle me-1"></i>Stock Bajo</span>`;
    colorStock = "text-warning";
  }

  panelInventario.innerHTML = `
    ${mensajeOperacion ? `<div class="alert alert-${tipoMensajeOperacion} py-2 mb-3">${mensajeOperacion}</div>` : ""}
    <div class="d-flex justify-content-between align-items-start mb-2">
      <div>
        <h5 class="fw-bold mb-0 text-primary">${p.nombre}</h5>
        <small class="text-muted">SKU: ${p.sku} | Cat: ${p.categoria}</small>
      </div>
      <span class="badge bg-primary-subtle text-primary border border-primary-subtle">
        ${certeza}% coincidencia
      </span>
    </div>

    <div class="d-flex justify-content-between align-items-center my-3 p-3 bg-light rounded-3">
      <div>
        <small class="text-muted d-block text-uppercase fw-semibold" style="font-size: 0.75rem;">Inventario actual</small>
        <span class="stock-number ${colorStock}">${p.stock}</span>
        <span class="text-muted fs-6">unidades</span>
      </div>
      <div>
        ${estadoBadge}
        <div class="small text-muted mt-1">Precio: <strong>Bs. ${p.precio.toFixed(2)}</strong></div>
      </div>
    </div>

    <!-- Botones interactivos para modificar el inventario -->
    <div class="d-flex gap-2">
      <button class="btn btn-outline-danger flex-grow-1 py-2 fw-semibold" onclick="capturarYQuitarDelStock();">
        <i class="bi bi-camera me-1"></i> Capturar y quitar
      </button>
      <button class="btn btn-primary flex-grow-1 py-2 fw-semibold" onclick="capturarYAgregarAlStock();">
        <i class="bi bi-camera me-1"></i> Capturar y agregar
      </button>
    </div>
    ${ultimaCaptura ? `
      <div class="mt-3 p-2 border rounded-3 bg-light">
        <div class="small text-success fw-semibold mb-2">
          <i class="bi bi-check-circle me-1"></i>Captura guardada en el dataset
          <span class="text-muted fw-normal">(${ultimaCaptura.fecha})</span>
        </div>
        <img src="${ultimaCaptura.imagen}" alt="Captura de la botella"
             class="img-fluid rounded-2 w-100" style="max-height: 180px; object-fit: cover;">
      </div>
    ` : ""}
  `;
}

// 9. Mostrar pantalla de búsqueda cuando no hay botella
function renderizarBuscando() {
  panelInventario.innerHTML = `
    <div class="text-center py-4 text-muted">
      <i class="bi bi-camera fs-1 d-block mb-2 text-secondary opacity-50"></i>
      <p class="mb-0 fw-medium">Buscando producto...</p>
      <small class="text-secondary">Enfoque la botella de agua dentro del recuadro</small>
    </div>
  `;
}

function reiniciarInventario() {
  reiniciarStock();
  ultimaCaptura = null;
  mensajeOperacion = "";
  renderizarInventario("Botella de Agua");
}

async function capturarYGuardar(action) {
  if (!video || video.readyState < video.HAVE_CURRENT_DATA) {
    mensajeOperacion = "No se pudo capturar la imagen. Espere a que la cámara esté activa e inténtelo de nuevo.";
    tipoMensajeOperacion = "warning";
    renderizarInventario("Botella de Agua");
    return;
  }

  if (action === "remove" && obtenerDatosBotella().stock === 0) {
    mensajeOperacion = "No se puede quitar el producto porque el stock está agotado.";
    tipoMensajeOperacion = "warning";
    renderizarInventario("Botella de Agua");
    return;
  }

  mensajeOperacion = "Guardando captura...";
  tipoMensajeOperacion = "info";
  renderizarInventario("Botella de Agua");

  try {
    const imagen = canvas.toDataURL("image/jpeg", 0.85);
    const response = await fetch("/api/capturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, image: imagen })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "El servidor no pudo guardar la captura.");
    }

    if (action === "add") {
      agregarUnidad();
      mensajeOperacion = "Producto agregado exitosamente al stock.";
    } else {
      descontarUnidad();
      mensajeOperacion = "Producto retirado exitosamente del stock.";
    }
    tipoMensajeOperacion = "success";
    ultimaCaptura = { imagen, fecha: new Date().toLocaleString("es-ES"), action };
    renderizarInventario("Botella de Agua");
  } catch (error) {
    console.error("Error al guardar el movimiento de inventario:", error);
    mensajeOperacion = `No se guardó el movimiento: ${error.message}`;
    tipoMensajeOperacion = "danger";
    renderizarInventario("Botella de Agua");
  }
}

function capturarYAgregarAlStock() {
  capturarYGuardar("add");
}

function capturarYQuitarDelStock() {
  capturarYGuardar("remove");
}

// Iniciar automáticamente al cargar la página
window.addEventListener("DOMContentLoaded", async () => {
  await cargarModelo();
  iniciarCamara();
});