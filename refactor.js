const fs = require('fs');
const path = require('path');

const chatControllerPath = path.join(__dirname, 'src', 'controllers', 'ChatController.js');
const csvControllerPath = path.join(__dirname, 'src', 'controllers', 'CsvController.js');

let chatCode = fs.readFileSync(chatControllerPath, 'utf8');
let csvCode = fs.readFileSync(csvControllerPath, 'utf8');

// Extraer los métodos de CSV/Insights del ChatController
const startIndex = chatCode.indexOf('    async getCsvPreview(req, res) {');
const endIndex = chatCode.indexOf('    async proxyDatasphere(req, res) {');

if (startIndex === -1 || endIndex === -1) {
    console.error("No se encontraron los límites en ChatController.js");
    process.exit(1);
}

const methodsToMove = chatCode.substring(startIndex, endIndex);

// Limpiar el ChatController
let newChatCode = chatCode.substring(0, startIndex) + chatCode.substring(endIndex);

// Inyectar en CsvController justo antes del fin de la clase
const moduleExportsStr = "module.exports = new CsvController();";
const csvClassEndIndex = csvCode.lastIndexOf('}', csvCode.lastIndexOf(moduleExportsStr));

if (csvClassEndIndex === -1) {
    console.error("No se encontró el fin de la clase CsvController");
    process.exit(1);
}

let newCsvCode = csvCode.substring(0, csvClassEndIndex) + 
    "\n    // --- Métodos Migrados desde ChatController ---\n\n" + 
    methodsToMove + 
    "\n" + csvCode.substring(csvClassEndIndex);

// Agregamos `next` a las firmas si queremos (opcional, pero las dejaremos así y en otro paso refactorizamos)
// Sobrescribir
fs.writeFileSync(chatControllerPath, newChatCode, 'utf8');
fs.writeFileSync(csvControllerPath, newCsvCode, 'utf8');

console.log("Migración exitosa.");
