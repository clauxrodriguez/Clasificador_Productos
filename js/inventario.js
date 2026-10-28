/**
 * js/inventario.js
 * Gestión de inventario enfocado en: Botella de Agua
 */

// Datos iniciales de la botella de agua
const productoInicial = {
  nombre: "Botella de Agua",
  sku: "BOT-001",
  categoria: "Bebidas",
  precio: 8.00,
  stock: 24,       // Stock inicial disponible
  stockMinimo: 5   // Umbral para avisar si queda poco stock
};

// Cargar inventario guardado en el celular o usar el inicial
let productoInventario = JSON.parse(localStorage.getItem("inventario_botella")) || { ...productoInicial };

// Guardar cambios en el navegador (para que no se borre al recargar)
function guardarInventario() {
  localStorage.setItem("inventario_botella", JSON.stringify(productoInventario));
}

// Obtener los datos actuales de la botella
function obtenerDatosBotella() {
  return productoInventario;
}

// Descontar 1 unidad (ejemplo: venta o salida de inventario)
function descontarUnidad() {
  if (productoInventario.stock > 0) {
    productoInventario.stock -= 1;
    guardarInventario();
    return true;
  }
  return false;
}

// Agregar 1 unidad (ejemplo: reposición o entrada de mercancía)
function agregarUnidad() {
  productoInventario.stock += 1;
  guardarInventario();
  return true;
}

// Restablecer el stock a su valor original (24 unidades)
function reiniciarStock() {
  productoInventario = { ...productoInicial };
  guardarInventario();
}