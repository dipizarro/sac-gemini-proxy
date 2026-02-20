const express = require("express");
const router = express.Router();
const ChatController = require("../controllers/ChatController");
const WidgetController = require("../controllers/WidgetController");

router.get("/health", (req, res) => {
    res.json({ ok: true, service: "sac-gemini-proxy" });
});

router.post("/chat", (req, res) => ChatController.handleChat(req, res));
router.get("/ds/movmat", (req, res) => ChatController.proxyDatasphere(req, res));
router.get("/csv/preview", (req, res) => ChatController.getCsvPreview(req, res));

router.get("/widget/main.js", (req, res) => WidgetController.serveWidget(req, res));
router.get("/demo", (req, res) => WidgetController.serveDemo(req, res));

// Export Preview
const ExportController = require("../controllers/ExportController");
router.get("/ds/export/preview", (req, res) => ExportController.getPreview(req, res));

// CSV Management
const CsvController = require("../controllers/CsvController");
router.get("/csv/status", (req, res) => CsvController.getStatus(req, res));
router.post("/csv/reload", (req, res) => CsvController.reload(req, res));
router.get("/csv/summary", (req, res) => CsvController.getSummary(req, res));
router.get("/csv/profile", (req, res) => CsvController.getProfile(req, res));
router.get("/csv/query/distinct-centers", (req, res) => CsvController.getDistinctCenters(req, res));

module.exports = router;
